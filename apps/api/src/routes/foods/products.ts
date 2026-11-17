import { createRoute } from '@hono/zod-openapi';
import { AiUnavailableError } from '@pt/ai';
import {
  ApiErrorSchema,
  BarcodeParamSchema,
  CUSTOM_FOOD_LIMITS,
  CustomFoodUpsertRequestSchema,
  CustomFoodsResponseSchema,
  FoodIdParamSchema,
  FoodLocaleQuerySchema,
  FoodSchema,
  LABEL_SCAN_LIMITS,
  LabelScanRequestSchema,
  LabelScanResponseSchema,
} from '@pt/contracts';
import { checkCustomFood, labelDraft, normalizeBarcode } from '@pt/core';
import { bodyLimit } from 'hono/body-limit';
import type { Deps } from '../../deps';
import { apiError, createRouter, errorBody } from '../../http';
import { IMAGE_BODY_MAX, checkImage, utcDayStart } from '../../images';
import { requireAuth, requireConsent } from '../../middleware/auth';
import { toFood } from '../../services/foods';
import { createBarcodeLookup } from '../../services/products';

const error = (description: string) => ({
  description,
  content: { 'application/json': { schema: ApiErrorSchema } },
});
const json = <T>(description: string, schema: T) => ({
  description,
  content: { 'application/json': { schema } },
});

/**
 * Scanned products, the user's own foods and the label photo (spec 006). Every route needs the current
 * consent: a barcode, a custom food and a label say what the user eats.
 */
export function productRoutes(deps: Deps) {
  const auth = requireAuth(deps.verifyToken);
  const consent = requireConsent(deps.store);
  const lookupBarcode = createBarcodeLookup(deps);

  const barcode = createRoute({
    method: 'get',
    path: '/foods/barcode/{code}',
    tags: ['foods'],
    middleware: [auth, consent] as const,
    request: { params: BarcodeParamSchema, query: FoodLocaleQuerySchema },
    responses: {
      200: json('The food of that barcode: the user’s own, or the product (AC3)', FoodSchema),
      400: error('Not a valid EAN-13, EAN-8, UPC-A or UPC-E'),
      401: error('Unauthenticated'),
      403: error('Consent required'),
      404: error('`product_not_found`, or `product_incomplete` (no usable values, AC4)'),
      429: error('Too many live lookups in a minute (AC7)'),
      503: error('`lookup_unavailable`: Open Food Facts did not answer (AC7)'),
    },
  });

  const listFoods = createRoute({
    method: 'get',
    path: '/me/foods',
    tags: ['food-log'],
    middleware: [auth, consent] as const,
    request: { query: FoodLocaleQuerySchema },
    responses: {
      200: json(
        'The user’s own foods, most recently changed first (AC12)',
        CustomFoodsResponseSchema,
      ),
      401: error('Unauthenticated'),
      403: error('Consent required'),
    },
  });

  const putFood = createRoute({
    method: 'put',
    path: '/me/foods/{foodId}',
    tags: ['food-log'],
    middleware: [auth, consent] as const,
    request: {
      params: FoodIdParamSchema,
      body: { content: { 'application/json': { schema: CustomFoodUpsertRequestSchema } } },
    },
    responses: {
      200: json('The stored food (idempotent, AC11)', FoodSchema),
      400: error('Invalid body or values, a barcode already used, or `food_limit_reached`'),
      401: error('Unauthenticated'),
      403: error('Consent required'),
      404: error('The id is not one of the user’s own foods (AC13)'),
    },
  });

  const deleteFood = createRoute({
    method: 'delete',
    path: '/me/foods/{foodId}',
    tags: ['food-log'],
    middleware: [auth, consent] as const,
    request: { params: FoodIdParamSchema },
    responses: {
      204: { description: 'Deleted (also when it did not exist)' },
      400: error('Invalid food id'),
      401: error('Unauthenticated'),
      403: error('Consent required'),
    },
  });

  const labelScan = createRoute({
    method: 'post',
    path: '/me/foods/label-scan',
    tags: ['food-log'],
    middleware: [
      auth,
      consent,
      bodyLimit({
        maxSize: IMAGE_BODY_MAX,
        onError: (c) => c.json(errorBody('image_too_large'), 413),
      }),
    ] as const,
    request: {
      body: { content: { 'application/json': { schema: LabelScanRequestSchema } } },
    },
    responses: {
      200: json(
        'The editable draft, or why the photo cannot be read (AC15–AC17)',
        LabelScanResponseSchema,
      ),
      400: error('Invalid body or image'),
      401: error('Unauthenticated'),
      403: error('Consent required'),
      413: error('`image_too_large`'),
      429: error('`ai_cap_reached`: the daily limit of label photos (AC18)'),
      503: error('`ai_unavailable`: the model gave no usable reading (AC17)'),
    },
  });

  return createRouter()
    .openapi(barcode, async (c) => {
      const { code } = c.req.valid('param');
      const { locale } = c.req.valid('query');
      const normalized = normalizeBarcode(code);
      if (normalized === null) return apiError(c, 400, 'validation_error', { code: 'invalid' });
      const result = await lookupBarcode(c.var.user.userId, normalized);
      switch (result.status) {
        case 'found':
          return c.json(toFood(result.food, locale), 200);
        case 'not_found':
          return apiError(c, 404, 'product_not_found');
        case 'incomplete':
          return apiError(c, 404, 'product_incomplete');
        case 'rate_limited':
          return apiError(c, 429, 'rate_limited');
        case 'unavailable':
          return apiError(c, 503, 'lookup_unavailable');
      }
    })
    .openapi(listFoods, async (c) => {
      const { locale } = c.req.valid('query');
      const foods = await deps.store.listCustomFoods(c.var.user.userId);
      return c.json({ foods: foods.map((f) => toFood(f, locale)) }, 200);
    })
    .openapi(putFood, async (c) => {
      const { foodId } = c.req.valid('param');
      const body = c.req.valid('json');
      const { userId } = c.var.user;
      const invalid = checkCustomFood(body);
      if (invalid) return apiError(c, 400, 'validation_error', invalid);
      if (body.barcode !== null && normalizeBarcode(body.barcode) !== body.barcode) {
        return apiError(c, 400, 'validation_error', { barcode: 'invalid' });
      }
      const own = await deps.store.listCustomFoods(userId);
      if (own.length >= CUSTOM_FOOD_LIMITS.foodsMax && !own.some((f) => f.id === foodId)) {
        return apiError(c, 400, 'food_limit_reached');
      }
      const saved = await deps.store.upsertCustomFood(userId, foodId, body, deps.now());
      if (saved === 'not_owner') return apiError(c, 404, 'not_found', { foodId: 'not_found' });
      if (saved === 'barcode_taken') {
        return apiError(c, 400, 'validation_error', { barcode: 'already_used' });
      }
      return c.json(toFood(saved, 'es'), 200);
    })
    .openapi(deleteFood, async (c) => {
      const { foodId } = c.req.valid('param');
      await deps.store.deleteCustomFood(c.var.user.userId, foodId);
      return c.body(null, 204);
    })
    .openapi(labelScan, async (c) => {
      const { image } = c.req.valid('json');
      const { userId } = c.var.user;
      const bad = checkImage(image);
      if (bad === 'invalid')
        return apiError(c, 400, 'validation_error', { 'image.data': 'invalid' });
      if (bad === 'too_large') return apiError(c, 413, 'image_too_large');
      const used = await deps.store.countAiUsage(userId, 'label_scan', utcDayStart(deps.now()));
      if (used >= LABEL_SCAN_LIMITS.perDay) return apiError(c, 429, 'ai_cap_reached');

      // AC19: the image goes to the model and nowhere else. It is never stored or logged.
      try {
        const { reading, usage } = await deps.readLabel(image);
        await deps.store.recordAiUsage(userId, usage, deps.now());
        return c.json(labelDraft(reading), 200);
      } catch (failure) {
        if (!(failure instanceof AiUnavailableError)) throw failure;
        await deps.store.recordAiUsage(userId, failure.usage, deps.now());
        return apiError(c, 503, 'ai_unavailable');
      }
    });
}
