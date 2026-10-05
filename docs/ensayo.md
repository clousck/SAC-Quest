# Ensayo con 10 personas

Una hora, en el servidor real, antes del evento. Sirve para encontrar lo que
solo aparece con varias personas a la vez: moderación, QR proyectados, tiempos.

## Quiénes

| Rol | Cuántos | Qué hacen |
|---|---|---|
| Participantes | 7 | Juegan desde su propio teléfono (al menos 2 iPhone y 2 Android; alguno con datos móviles, no wifi) |
| Moderadores | 2 | Aprueban y rechazan fotos, uno desde el teléfono |
| Coordinador | 1 | Admin: abre y cierra retos, proyecta, toma nota |

## Preparar (el día anterior)

1. Crear un evento **de ensayo** (no el real) con 3 Ramas: una de 4 personas,
   una de 2 y una de 1.
2. Retos, uno de cada clase:
   - «Selfie en el evento» (foto, 10 XP).
   - Una foto con desbloqueo: exige la selfie.
   - AR con Watt.
   - Un checkpoint QR visible y otro **secreto con cupo 3**.
   - Una encuesta **solo con QR**, con 2 preguntas con respuesta correcta
     (mínimo 1), una escala y una de texto.
3. Dos retos de Rama: «3 integrantes completan la selfie» y «2 integrantes
   escanean el checkpoint».
4. Imprimir los QR de los checkpoints y esconder el secreto.
5. Cuentas de moderador creadas y probadas.
6. Pausar las actualizaciones automáticas: `touch .deploy/pause` en el servidor.

## Guion (45 minutos)

| Min | Qué | Qué mirar |
|---|---|---|
| 0 | Proyectar el QR de entrada; todos entran | ¿Alguien no puede entrar? ¿Con qué teléfono y navegador? |
| 5 | Selfie | ¿Cuánto tarda en llegar a Moderar? ¿Los dos moderadores ven la misma foto? |
| 10 | Un moderador **rechaza** una selfie con motivo | ¿La persona ve el motivo y puede reintentar? |
| 15 | Foto con desbloqueo y AR con Watt | ¿Se desbloquea al aprobar la selfie? ¿El AR funciona en iPhone y en Android? |
| 25 | Checkpoints: el visible y el secreto con cupo | ¿El cuarto que escanea el secreto ve «cupo lleno»? |
| 30 | Encuesta: **Abrir 3 min**, proyectar su QR | ¿Entran todos? ¿Se cierra sola? ¿Después se ven las correctas? |
| 35 | Uno activa el modo avión, toma una foto y vuelve a conectar | ¿La foto se envía sola? |
| 38 | Uno entra desde otro teléfono con su código de recuperación | ¿Conserva su XP? |
| 40 | Pantalla grande con el ranking; el coordinador manda un **aviso** | ¿El XP por Rama se entiende? ¿Los retos de Rama se marcan cumplidos? ¿El aviso llega a todos en menos de un minuto? |
| 45 | Cerrar evento; descargar ZIP y CSV de la encuesta | ¿Bajan completos? |

## Anotar

- Cada cosa que alguien **preguntó** o no entendió: eso va a pasar 10 veces más
  en el evento.
- Tiempo desde que se envía una foto hasta que se aprueba.
- Cualquier error en pantalla, con el modelo de teléfono y el navegador.
- En el servidor, al final: `docker compose logs app --since 1h | grep -i error`.

## Después

1. Corregir lo que se encontró y repetir solo esa parte.
2. Borrar el evento de ensayo (Ajustes → Borrar evento).
3. Quitar la pausa: `rm .deploy/pause`.
