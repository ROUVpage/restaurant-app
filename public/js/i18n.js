const LANGUAGE_STORAGE_KEY = 'restaurant_language';
const DEFAULT_LANGUAGE = 'en';

const translations = {
  'Carta del Restaurante': 'Restaurant Menu',
  'Carta general': 'General menu',
  'Nuestra carta': 'Our menu',
  'Reservar mesa': 'Book a table',
  'Reservar': 'Book',
  'Mesa —': 'Table —',
  'Tapas': 'Small plates',
  'Raciones': 'Sharing plates',
  'Bebidas': 'Drinks',
  'Postres': 'Desserts',
  'Llamar camarero': 'Call waiter',
  'Llamar al camarero': 'Call the waiter',
  'Camarero': 'Waiter',
  'Nuevo pedido': 'New order',
  'Nuevo': 'New',
  'pedido': 'order',
  'Pagar': 'Pay',
  'El camarero está en camino': 'The waiter is on the way',
  'Mesa no autorizada': 'Unauthorized table',
  'La mesa no ha sido autorizada por el bar para realizar pedidos. Ponte en contacto con tu camarero para empezar a pedir desde la web.': 'This table has not been authorized by the restaurant to place orders. Please contact your waiter to start ordering online.',
  'Cerrar pestaña': 'Close tab',
  'Cuenta finalizada': 'Bill closed',
  'Su cuenta ha sido finalizada. Pongase en contacto con su camarero en caso de error.': 'Your bill has been closed. Please contact your waiter if this is an error.',
  'Cerrar': 'Close',
  'Nuevo Pedido — Mesa': 'New Order — Table',
  'Cancelar pedido': 'Cancel order',
  'Cancelar': 'Cancel',
  'Finalizar Pedido': 'Place order',
  'Finalizar': 'Finish',
  'Confirmar Pedido': 'Confirm order',
  'Confirmar pedido': 'Confirm order',
  'Confirmar': 'Confirm',
  '¡Pedido enviado!': 'Order sent!',
  'Tu pedido ha sido recibido. En breve te lo traeremos.': 'Your order has been received. We will bring it shortly.',
  'Volver a la carta': 'Back to menu',
  'Pagar — Mesa': 'Pay — Table',
  'Resumen cuenta': 'Bill summary',
  'Desglose de Cuenta': 'Bill breakdown',
  'Pago confirmado. ¡Gracias!': 'Payment confirmed. Thank you!',
  'Volver': 'Back',
  'Pagar en efectivo': 'Pay with cash',
  'Pagar efectivo': 'Pay cash',
  'Confirmar pago': 'Confirm payment',
  'Pago seguro': 'Secure payment',
  'Total a pagar': 'Total to pay',
  'Elige cómo pagar': 'Choose how to pay',
  'Pago procesado de forma segura por PayPal.': 'Payment securely processed by PayPal.',
  'Confirmar pago en efectivo': 'Confirm cash payment',
  'Total a cobrar:': 'Total to charge:',
  '¿Deseas confirmar este pago en efectivo y cerrar la sesión de la mesa?': 'Would you like to confirm this cash payment and close the table session?',
  'Acceso — Panel de Gestión': 'Access — Management Panel',
  'Panel de Gestión': 'Management Panel',
  'Acceso privado para personal': 'Private staff access',
  'Usuario': 'Username',
  'Contraseña': 'Password',
  'Credenciales incorrectas': 'Incorrect credentials',
  'Iniciar Sesión': 'Sign in',
  'Panel de Gestión — Mesas': 'Management Panel — Tables',
  'Mesas': 'Tables',
  'Abrir menú': 'Open menu',
  'Reservas': 'Reservations',
  'Cerrar sesión': 'Sign out',
  'Conectar con PayPal': 'Connect PayPal',
  'Mesas Activas': 'Active tables',
  'No hay mesas activas': 'No active tables',
  'Pedidos en Cola': 'Orders in queue',
  'Sin pedidos pendientes': 'No pending orders',
  'Nueva Mesa': 'New table',
  'Crear Nueva Mesa': 'Create new table',
  'Número de Mesa': 'Table number',
  'Número de Personas': 'Number of people',
  'Ej: 5': 'E.g. 5',
  'Ej: 4': 'E.g. 4',
  'Código QR': 'QR code',
  'Imprimir QR': 'Print QR',
  'Cuenta — Mesa': 'Bill — Table',
  'Finalizar mesa': 'Close table',
  'Pago Recibido': 'Payment received',
  'Pedido finalizado — Pago confirmado': 'Order completed — Payment confirmed',
  'Finalizar Mesa': 'Close table',
  '¿Cómo quieres finalizar la mesa?': 'How would you like to close the table?',
  'Imprimir ticket': 'Print receipt',
  'Eliminar mesa': 'Remove table',
  'Cuenta PayPal conectada': 'PayPal account connected',
  'La cuenta PayPal ya está conectada. ¿Quieres desconectarla?': 'The PayPal account is already connected. Would you like to disconnect it?',
  'Aceptar': 'Accept',
  'Panel Privado - Reservas': 'Private Panel - Reservations',
  'Panel de Reservas': 'Reservations Panel',
  'Volver a mesas': 'Back to tables',
  'Cerrar sesion': 'Sign out',
  'Mes anterior': 'Previous month',
  'Mes siguiente': 'Next month',
  'Seleccionar mes': 'Select month',
  'Seleccionar ano': 'Select year',
  'Selecciona un dia': 'Select a day',
  'Elige fecha y turno (14:00 o 21:00) segun disponibilidad.': 'Choose a date and sitting (14:00 or 21:00), subject to availability.',
  'Cancelar reserva': 'Cancel reservation',
  'Reserva disponible todo el año.': 'Bookings available all year round.',
  'Comida - 14:00': 'Lunch - 14:00',
  'Cena - 21:00': 'Dinner - 21:00',
  'Cargando...': 'Loading...',
  'Nombre': 'Name',
  'Numero de telefono': 'Phone number',
  'Numero de personas': 'Number of people',
  'Ej: Ana Perez': 'E.g. Jane Smith',
  'Revisar reserva': 'Review booking',
  'Confirmacion de reserva': 'Booking confirmation',
  'Fecha': 'Date',
  'Turno': 'Sitting',
  'Telefono': 'Phone',
  'Personas': 'People',
  'Editar datos': 'Edit details',
  'Editar': 'Edit',
  'Confirmar reserva': 'Confirm booking',
  'Para cancelar la reserva, llama al restaurante al': 'To cancel your booking, call the restaurant on',
  'Entendido': 'Got it',
  'Guardar': 'Save',
  'Cerrar turno': 'Close sitting',
  'Nueva reserva': 'New booking',
  'Hacer reserva': 'Make booking',
  'Reservas del dia': 'Bookings for the day'
  , 'Politica de Privacidad': 'Privacy Policy'
  , 'Terminos de Uso': 'Terms of Use'
  , 'Volver al inicio': 'Back to home'
  , 'Ultima actualizacion: 13/06/2026': 'Last updated: 13/06/2026'
  , '1. Responsable del tratamiento': '1. Data controller'
  , 'Restaurante (titular del local) es el responsable del tratamiento de los datos recogidos en esta aplicacion.': 'The restaurant (the venue owner) is responsible for processing the data collected through this application.'
  , '2. Datos que tratamos': '2. Data we process'
  , 'Datos de reserva: nombre, telefono, fecha, turno y numero de personas.': 'Booking data: name, telephone number, date, sitting and number of guests.'
  , 'Datos operativos: pedidos, mesa, hora de creacion y estado.': 'Operational data: orders, table, creation time and status.'
  , 'Datos de pago: estado del pago e identificadores tecnicos de transaccion.': 'Payment data: payment status and technical transaction identifiers.'
  , '3. Finalidad del tratamiento': '3. Purpose of processing'
  , 'Gestionar reservas, pedidos y pagos del restaurante.': 'Manage the restaurant’s bookings, orders and payments.'
  , 'Atender incidencias y soporte.': 'Handle incidents and provide support.'
  , 'Cumplir obligaciones legales y fiscales.': 'Meet legal and tax obligations.'
  , '4. Pasarela de pago PayPal': '4. PayPal payment gateway'
  , 'Los pagos online se procesan mediante PayPal. Esta aplicacion no almacena credenciales bancarias completas del cliente.': 'Online payments are processed by PayPal. This application does not store the customer’s complete bank credentials.'
  , '5. Base legal': '5. Legal basis'
  , 'Ejecucion de la prestacion del servicio solicitado y cumplimiento de obligaciones legales.': 'Performance of the requested service and compliance with legal obligations.'
  , '6. Conservacion': '6. Data retention'
  , 'Los datos se conservan durante el tiempo necesario para la gestion del servicio y los plazos legales aplicables.': 'Data is retained for the time needed to manage the service and for the applicable legal retention periods.'
  , '7. Cesiones y encargados': '7. Recipients and processors'
  , 'Los datos solo se comparten con proveedores estrictamente necesarios para operar el servicio, como PayPal y proveedores de alojamiento.': 'Data is shared only with providers strictly necessary to operate the service, such as PayPal and hosting providers.'
  , '8. Derechos': '8. Your rights'
  , 'Puedes solicitar acceso, rectificacion o supresion de tus datos escribiendo al email de contacto del restaurante.': 'You can request access to, correction of, or deletion of your data by writing to the restaurant’s contact email address.'
  , '9. Seguridad': '9. Security'
  , 'Se aplican medidas tecnicas y organizativas razonables para proteger la informacion tratada.': 'Reasonable technical and organizational measures are applied to protect the information we process.'
  , '10. Contacto': '10. Contact'
  , 'Para cualquier consulta sobre privacidad, contacta con el establecimiento.': 'For any privacy-related questions, please contact the restaurant.'
  , '1. Objeto': '1. Purpose'
  , 'Estos terminos regulan el uso de la aplicacion de reservas, pedidos y pagos del restaurante.': 'These terms govern use of the restaurant’s booking, ordering and payment application.'
  , '2. Aceptacion': '2. Acceptance'
  , 'Al usar la aplicacion, aceptas estos terminos y la politica de privacidad.': 'By using the application, you accept these terms and the privacy policy.'
  , '3. Uso permitido': '3. Permitted use'
  , 'Usar la aplicacion de forma legal y de buena fe.': 'Use the application lawfully and in good faith.'
  , 'No realizar acciones fraudulentas ni interferir con el servicio.': 'Do not carry out fraudulent actions or interfere with the service.'
  , '4. Reservas y pedidos': '4. Bookings and orders'
  , 'El restaurante puede confirmar, modificar o cancelar reservas/pedidos por razones operativas o de disponibilidad.': 'The restaurant may confirm, modify or cancel bookings and orders for operational or availability reasons.'
  , '5. Pagos': '5. Payments'
  , 'Los pagos online se procesan mediante PayPal. Tambien aplican las condiciones de PayPal para el usuario pagador.': 'Online payments are processed through PayPal. PayPal’s terms also apply to the paying user.'
  , '6. Disponibilidad del servicio': '6. Service availability'
  , 'Se realizan esfuerzos razonables para mantener el servicio activo, pero no se garantiza disponibilidad ininterrumpida.': 'Reasonable efforts are made to keep the service available, but uninterrupted availability is not guaranteed.'
  , '7. Limitacion de responsabilidad': '7. Limitation of liability'
  , 'Dentro de lo permitido por la ley, el titular no responde por danos indirectos derivados de interrupciones del servicio o uso indebido por terceros.': 'To the extent permitted by law, the owner is not liable for indirect damage arising from service interruptions or misuse by third parties.'
  , '8. Propiedad intelectual': '8. Intellectual property'
  , 'Los contenidos, diseno y codigo de la aplicacion estan protegidos por derechos de propiedad intelectual.': 'The application’s content, design and code are protected by intellectual property rights.'
  , '9. Modificaciones': '9. Changes'
  , 'Estos terminos pueden actualizarse. La version vigente sera la publicada en esta pagina.': 'These terms may be updated. The version in force is the one published on this page.'
  , '10. Legislacion aplicable': '10. Applicable law'
  , 'Estos terminos se rigen por la normativa aplicable en Espana.': 'These terms are governed by the laws applicable in Spain.'
};

function getLanguage() {
  return localStorage.getItem(LANGUAGE_STORAGE_KEY) || DEFAULT_LANGUAGE;
}

function translateValue(value) {
  return getLanguage() === 'en' ? (translations[value] || value) : value;
}

function translateElement(element) {
  if (element.nodeType === Node.TEXT_NODE) {
    const original = element.__originalText ?? element.textContent.trim();
    if (original) {
      element.__originalText = original;
      const leading = element.textContent.match(/^\s*/)[0];
      const trailing = element.textContent.match(/\s*$/)[0];
      element.textContent = leading + translateValue(original) + trailing;
    }
    return;
  }

  if (element.nodeType !== Node.ELEMENT_NODE || element.closest('.language-switcher')) return;
  ['title', 'aria-label', 'placeholder'].forEach((attribute) => {
    if (element.hasAttribute(attribute)) {
      const original = element.dataset[`i18n${attribute.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())}`] || element.getAttribute(attribute);
      element.dataset[`i18n${attribute.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())}`] = original;
      element.setAttribute(attribute, translateValue(original));
    }
  });
  element.childNodes.forEach(translateElement);
}

function applyTranslations() {
  document.documentElement.lang = getLanguage();
  const originalTitle = document.documentElement.dataset.i18nTitle || document.title;
  document.documentElement.dataset.i18nTitle = originalTitle;
  document.title = translateValue(originalTitle);
  translateElement(document.body);
}

function addLanguageSwitcher() {
  const actions = document.querySelector('.header-actions, .reservas-header-actions');
  if (document.querySelector('.language-switcher')) return;

  const select = document.createElement('select');
  select.className = 'language-switcher language-switcher-fixed';
  select.setAttribute('aria-label', 'Language');
  select.innerHTML = '<option value="en">English</option><option value="es">Spanish</option>';
  select.value = getLanguage();
  select.addEventListener('change', () => {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, select.value);
    window.location.reload();
  });
  if (actions) {
    select.classList.remove('language-switcher-fixed');
    actions.prepend(select);
  } else {
    document.body.append(select);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  addLanguageSwitcher();
  applyTranslations();
  new MutationObserver((changes) => {
    if (getLanguage() !== 'en') return;
    changes.forEach((change) => change.addedNodes.forEach(translateElement));
  }).observe(document.body, { childList: true, subtree: true });
});