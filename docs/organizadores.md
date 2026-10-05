# Guía para organizadores y moderadores

Cómo usar el panel de SAC Quest: `https://sacquest.penginexr.com/admin`.
Hay dos roles: **admin** (todo) y **moderador** (revisar fotos, gestionar
participantes, ver rankings y resultados, descargar).

## Antes del evento (admin)

1. **Crear el evento** (o duplicar uno anterior desde Ajustes → Duplicar).
2. **Ajustes → Ramas**: cargar las Ramas, una por línea. Las Ramas muy chicas
   se pueden juntar en una sola (máximo 5 personas por Rama unida): se crea la
   Rama unida aquí y se mueve a las personas desde **Participantes**.
3. **Retos → Nuevo reto**. Tipos:

   | Tipo | Cómo se completa | Quién aprueba |
   |---|---|---|
   | 📷 Foto | Foto con la cámara | Un moderador |
   | 🐱 AR con Watt | Foto con Watt en la cámara | Un moderador |
   | 📍 Checkpoint QR | Escanear un QR impreso | Automático |
   | 📝 Encuesta | Responder preguntas (una sola vez) | Automático |

   Opciones útiles de cada reto:
   - **Valor**: define los puntos (Rápido 10, Normal 20, Difícil 40, Especial 80).
     Los valores se editan en Ajustes → Valores de reto; si cambias los puntos de
     un valor, cambian sus retos y los puntos ya ganados con ellos. «Sin XP» es
     para retos que solo cuentan para la Rama (p. ej. una foto grupal).
   - **Secreto**: no aparece en la lista hasta que se desbloquea o se escanea su QR.
   - **Límite de participantes**: solo los primeros N lo completan (QR escondidos).
   - **Desbloqueo → Completar antes**: p. ej. exigir «Selfie en el evento» antes
     de los retos importantes. Solo cuenta cuando la selfie está **aprobada**.
4. **Encuestas**: en el reto, agregar las preguntas (opción única, escala 1–5,
   texto). Si una opción es la correcta, marcar su círculo y definir los
   aciertos mínimos. Con «Solo se puede responder escaneando su QR», la encuesta
   se abre proyectando su QR al final de la charla.
5. **Ajustes → Retos de Rama**: «N o más integrantes completan el reto X» (N de
   1 a 5). Dan puntos a la Rama, no a las personas. Sin retos de Rama, nadie suma
   esa parte del puntaje.
6. **Retos → Imprimir QRs**: el de entrada va en carteles; cada checkpoint, en
   su lugar. El de cada encuesta se proyecta.
7. **Usuarios** (arriba a la derecha): crear una cuenta por moderador.

## Durante el evento

- **Ajustes → Abrir evento** al empezar.
- **Moderar**: aparece una foto a la vez. Aprobar suma los puntos; rechazar pide
  un motivo y la persona puede volver a intentarlo. Funciona bien desde el
  teléfono. Se puede filtrar por reto para repartirse el trabajo.
- **Abrir y cerrar retos al momento** (lista de Retos, en checkpoints y encuestas):
  - **Abrir X min**: se cierra solo al terminar el tiempo.
  - **Cerrar ahora**: nadie más puede completarlo; quienes ya respondieron una
    encuesta ven desde ese momento las respuestas correctas.
  - **Abrir ahora**: lo reabre sin límite.

  Usar estos botones y no «Desactivar»: desactivar esconde el reto por completo.
- **Resultados de una encuesta**: en la lista de Retos, «📊 Ver resultados»
  (totales por pregunta, respuestas por persona y descarga en CSV).
- **Resumen → Avisos a los participantes**: un mensaje corto («La charla 2
  empieza en 5 minutos») que les aparece en pantalla en menos de un minuto.
- **Ranking → Pantalla grande**: para proyectar; se actualiza sola.
- **Participantes**: cambiar de Rama, corregir un nombre o **suspender** a
  alguien (desaparece del ranking y de la galería). Ahí está también el
  **código de recuperación** de cada persona, por si cambia de teléfono.

## Problemas frecuentes de los participantes

| Le pasa | Qué hacer |
|---|---|
| Cambió de teléfono o se le borró la sesión | Entrar de nuevo → «¿Participaste? Entra con tu código de recuperación» (el código está en Participantes) |
| La cámara se ve en negro | Abrió el enlace desde Instagram, Facebook o TikTok: abrirlo en Chrome o Safari |
| «Escanea el código QR de la encuesta» | Escanear el QR proyectado o escribir el código que está debajo |
| Subió la foto equivocada | Puede borrarla desde su perfil y volver a enviarla |
| Sin señal al enviar la foto | Queda guardada en el teléfono y se envía sola cuando vuelve la conexión |

## Al terminar

1. **Ajustes → Cerrar evento**: congela el ranking; la galería sigue visible.
2. **Galería → Descargar ZIP** con las fotos aprobadas, y el CSV de cada encuesta.
3. Guardar ambos fuera del servidor.

## Cómo se calcula el XP de una Rama

Está en las mismas unidades que el XP de las personas y suma tres partes:

- **Mejores**: el XP de sus 5 mejores integrantes. El primero cuenta completo;
  los siguientes, 60 %, 40 %, 25 % y 15 %.
- **Participación**: un bono por cada integrante con al menos un reto aprobado
  con puntos. Cada uno suma un poco menos que el anterior; el bono completo se
  alcanza con 10.
- **Retos de Rama**: según cuántos retos de Rama cumplió.

El bono de participación y los retos de Rama pueden valer, cada uno, hasta la
mitad de lo máximo que pueden sumar los mejores (los cinco con todos los retos
del evento). Esos porcentajes se cambian en Ajustes → XP por Rama.

Los inscritos que no participan no suman nada. El XP de cada persona no cambia.
Con pocos retos en el evento es fácil que varias Ramas lleguen cerca del máximo:
conviene tener variedad y algunos retos difíciles.
