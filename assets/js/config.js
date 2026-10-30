/*
 * CONFIGURACIÓN DEL CATÁLOGO COLEX
 * --------------------------------
 * Este es el ÚNICO archivo que se edita al publicar.
 * Copie aquí los dos valores de su proyecto Supabase
 * (Supabase › Project Settings › API): "Project URL" y "anon public key".
 *
 * Si se dejan vacíos, el catálogo funciona en MODO DEMOSTRACIÓN:
 * lee data/productos.json y los cambios del panel solo se guardan
 * en el navegador donde se hicieron.
 */
window.COLEX_CONFIG = {
  SUPABASE_URL: "",
  SUPABASE_ANON_KEY: "",

  // ¿El cliente ve cuántas unidades hay? false = no ve existencias y puede pedir cualquier cantidad.
  // Cambie a true para volver a mostrarlas (y limitar la cantidad a lo disponible).
  MOSTRAR_EXISTENCIAS: false,

  // Nombre del depósito de imágenes en Supabase Storage (no cambiar).
  BUCKET_IMAGENES: "productos",

  // Correo del administrador. En modo demostración solo este correo puede entrar al panel.
  ADMIN_EMAIL: "abmoisesr@gmail.com",

  // Modo demostración: huella (SHA-256) de la contraseña del panel, nunca la contraseña.
  // Con Supabase configurado, la contraseña real se define en Supabase › Authentication.
  DEMO_PASSWORD_SHA256: "0317380b2483710e83d0fa89f6d9d6fe11f101358373aa606b5f55f9c249a20c"
};
