export const es = {
  app: {
    name: 'Personal Trainer',
    tagline: 'Nutrición y entrenamiento con IA',
  },
  nav: {
    dashboard: 'Panel',
    nutrition: 'Nutrición',
    training: 'Entrenamiento',
    ranking: 'Ranking',
  },
  common: {
    continue: 'Continuar',
    back: 'Volver',
    retry: 'Reintentar',
    loading: 'Cargando…',
    signOut: 'Cerrar sesión',
    notMedicalAdvice: 'Esta app no sustituye el consejo de un profesional sanitario.',
    demoMode: 'Modo demo: datos simulados que solo se guardan en este dispositivo.',
  },
  auth: {
    signIn: {
      title: 'Entra o crea tu cuenta',
      subtitle: 'Te enviaremos un código de 6 dígitos por email. Sin contraseñas.',
      emailLabel: 'Email',
      emailPlaceholder: 'tu@email.com',
      sendCode: 'Enviar código',
      or: 'o',
      google: 'Continuar con Google',
    },
    verify: {
      title: 'Introduce el código',
      subtitle: 'Te lo hemos enviado a {email}. Caduca en 10 minutos.',
      codeLabel: 'Código de 6 dígitos',
      submit: 'Verificar',
      resend: 'Reenviar código',
      resendIn: 'Podrás pedir otro código en {seconds} s',
      resent: 'Te hemos enviado un código nuevo.',
      changeEmail: 'Usar otro email',
      demoHint: 'Modo demo: el código es 123456 (000000 simula un código caducado).',
    },
    errors: {
      invalid_email: 'Ese email no parece válido. Revísalo.',
      invalid_code: 'El código no es correcto. Revísalo o pide uno nuevo.',
      expired_code: 'El código ha caducado. Pide uno nuevo.',
      rate_limited: 'Demasiados intentos. Espera un minuto y vuelve a probar.',
      network: 'No hay conexión. Comprueba tu red y vuelve a intentarlo.',
      cancelled: 'Has cancelado el inicio de sesión con Google.',
      not_configured:
        'El inicio de sesión real aún no está conectado. Para probar la app, arráncala en modo demo: pnpm --filter @pt/app web:mock',
      unknown: 'Algo ha fallado. Vuelve a intentarlo.',
    },
  },
  consent: {
    title: 'Tus datos de salud',
    intro:
      'Para calcular tus objetivos necesitamos algunos datos de salud. Antes de seguir, esto es lo que hacemos con ellos:',
    points: {
      what: 'Guardamos tu sexo, fecha de nacimiento, altura, peso, nivel de actividad, objetivo, dieta, alergias y lesiones.',
      where: 'Se guardan en servidores de la Unión Europea y solo tú puedes verlos.',
      ai: 'Si usas el chat, tus mensajes los procesa un proveedor de IA (Anthropic, en la UE o en EE. UU.) con un contrato de encargo de tratamiento. No guardamos las conversaciones.',
      control: 'Puedes descargar o borrar todos tus datos cuando quieras en Ajustes → Privacidad.',
      advice:
        'Las recomendaciones son orientativas y no sustituyen el consejo de un profesional sanitario.',
    },
    checkbox:
      'Doy mi consentimiento explícito para que se traten mis datos de salud con esta finalidad.',
    privacyPending: 'La política de privacidad completa estará disponible antes del lanzamiento.',
    accept: 'Aceptar y continuar',
  },
  onboarding: {
    placeholder: 'El chat de bienvenida llega en el siguiente paso.',
  },
  home: {
    title: 'Hoy',
    welcome: 'Ya tienes tus objetivos. Pronto podrás registrar comidas y entrenamientos.',
  },
  errors: {
    unauthorized: 'Tu sesión ha caducado. Vuelve a entrar.',
    consent_required: 'Necesitamos tu consentimiento para continuar.',
    validation_error: 'Revisa los datos marcados.',
    age_blocked: 'Esta app no está disponible para menores de 16 años.',
    rate_limited: 'Has alcanzado el límite de mensajes por hoy.',
    ai_unavailable: 'El asistente no está disponible ahora mismo.',
    not_found: 'No hemos encontrado lo que buscabas.',
    internal_error: 'Algo ha fallado en el servidor. Vuelve a intentarlo.',
    network: 'No hay conexión con el servidor. Comprueba tu red.',
    unknown: 'Algo ha fallado. Vuelve a intentarlo.',
    loadAccount: 'No hemos podido cargar tu cuenta.',
  },
} as const;
