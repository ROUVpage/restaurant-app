# Webhook de reservas en Make

La app ya está configurada para enviar una notificación por webhook cada vez que se crea una reserva.

## Webhook activo

```env
RESERVATION_WEBHOOK_URL=https://hook.eu2.make.com/bkia719bgn558wd3hxtz1nawwcy8p184
```

## JSON que recibe Make

La app hace un `POST` con `Content-Type: application/json` y este cuerpo:

```json
{
  "targetEmail": "padelstats0@gmail.com",
  "reservation": {
    "date": "2026-06-05",
    "slot": "lunch",
    "slotLabel": "Comida - 14:00",
    "name": "Ana Perez",
    "phone": "600123123",
    "persons": 2,
    "source": "public",
    "createdAt": 1717580000
  }
}
```

## Escenario en Make

1. Crea un escenario nuevo.
2. Añade `Webhooks > Custom webhook` como primer módulo.
3. Usa la URL ya puesta en `.env`.
4. Pulsa `Run once` en Make.
5. Haz una reserva de prueba desde la web para que Make capture el JSON.
6. Añade el módulo `Email > Send an email`.
7. En `To`, usa `padelstats0@gmail.com`.
8. En `Subject`, usa `Nueva reserva - {{reservation.name}}`.
9. En el cuerpo pega algo como esto:

```text
Nueva reserva recibida

Fecha: {{reservation.date}}
Turno: {{reservation.slotLabel}}
Nombre: {{reservation.name}}
Telefono: {{reservation.phone}}
Personas: {{reservation.persons}}
Origen: {{reservation.source}}
```

## Campos útiles para mapear

- `reservation.date`: fecha de la reserva.
- `reservation.slotLabel`: turno legible.
- `reservation.name`: nombre.
- `reservation.phone`: teléfono.
- `reservation.persons`: número de personas.
- `reservation.source`: `public` o `admin`.

## Notas

- La app sigue creando la reserva aunque el webhook falle.
- El correo sale desde Make, así no necesitas contraseñas personales en la web.

## Si no se envia el correo

1. Verifica que el escenario esta en `ON` o en `Run once` cuando haces la reserva.
2. Abre el ultimo historial de ejecucion y revisa el modulo `Gmail > Send an email`.
3. Comprueba que la conexion de Gmail este autorizada y sin caducar.
4. En `To`, usa `padelstats0@gmail.com` o mapea `targetEmail`.
5. Pulsa `Save` en el escenario despues de mapear campos.
