/** Same key structure as T, but every leaf is any string (so translations can differ). */
export type DeepStringRecord<T> = {
  -readonly [K in keyof T]: T[K] extends string ? string : DeepStringRecord<T[K]>;
};
