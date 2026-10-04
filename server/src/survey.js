import { badRequest, int, str } from './util.js'

/**
 * Encuestas (retos de tipo TRIVIA). Las preguntas viven en
 * challenges.config.survey y las respuestas de cada persona en
 * submissions.answer; no hay tablas propias.
 *
 * survey: {
 *   qrOnly: boolean        solo se responde escaneando su QR
 *   minCorrect: number     aciertos minimos para ganar los puntos (0 = basta responder)
 *   questions: [{ id, type: 'choice' | 'scale' | 'text', text, options?, correct? }]
 * }
 * `correct` es el indice de la opcion correcta (solo en 'choice'); null si
 * la pregunta es de opinion.
 */

export const QUESTION_TYPES = ['choice', 'scale', 'text']
const MAX_QUESTIONS = 20
const SCALE_MAX = 5

/** Valida lo que manda el panel. Lanza 400 con un mensaje claro. */
export function normalizeSurvey(v) {
  if (!v || typeof v !== 'object' || !Array.isArray(v.questions) || !v.questions.length) {
    throw badRequest('La encuesta necesita al menos una pregunta.')
  }
  if (v.questions.length > MAX_QUESTIONS) throw badRequest(`Máximo ${MAX_QUESTIONS} preguntas.`)
  const ids = new Set()
  const questions = v.questions.map((q, i) => {
    const n = i + 1
    if (!q || !QUESTION_TYPES.includes(q.type)) throw badRequest(`Pregunta ${n}: tipo inválido.`)
    // El id se conserva al editar para que las respuestas sigan apuntando a su pregunta.
    let id = typeof q.id === 'string' && /^[a-z0-9]{1,12}$/.test(q.id) && !ids.has(q.id) ? q.id : null
    for (let k = 1; !id; k++) if (!ids.has(`q${k}`)) id = `q${k}`
    ids.add(id)
    const out = { id, type: q.type, text: str(q.text, `texto de la pregunta ${n}`, { min: 2, max: 300 }) }
    if (q.type === 'choice') {
      if (!Array.isArray(q.options) || q.options.length < 2 || q.options.length > 6) {
        throw badRequest(`Pregunta ${n}: debe tener entre 2 y 6 opciones.`)
      }
      out.options = q.options.map((o) => str(o, `opción de la pregunta ${n}`, { min: 1, max: 120 }))
      out.correct = q.correct == null || q.correct === '' ? null : int(q.correct, `respuesta correcta de la pregunta ${n}`, { min: 0, max: out.options.length - 1 })
    }
    return out
  })
  const gradable = questions.filter((q) => q.correct != null).length
  return {
    qrOnly: !!v.qrOnly,
    minCorrect: int(v.minCorrect ?? 0, 'aciertos mínimos', { min: 0, max: gradable }),
    questions,
  }
}

export const gradableCount = (survey) => survey.questions.filter((q) => q.correct != null).length

/** Lo que ve el telefono: sin respuestas correctas, salvo que la encuesta ya haya cerrado. */
export function publicQuestions(survey, { reveal = false } = {}) {
  return survey.questions.map((q) => {
    const out = { id: q.id, type: q.type, text: q.text }
    if (q.type === 'choice') out.options = q.options
    if (q.type === 'scale') out.max = SCALE_MAX
    if (reveal && q.correct != null) out.correct = q.correct
    return out
  })
}

/**
 * Valida y corrige las respuestas de una persona. Las de opcion y escala son
 * obligatorias; el texto es opcional.
 */
export function gradeSurvey(survey, raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw badRequest('Faltan las respuestas.')
  const answers = {}
  let correct = 0
  for (const [i, q] of survey.questions.entries()) {
    const v = raw[q.id]
    const n = i + 1
    if (q.type === 'text') {
      const text = typeof v === 'string' ? v.trim().slice(0, 500) : ''
      if (text) answers[q.id] = text
      continue
    }
    if (v == null || v === '') throw badRequest(`Falta responder la pregunta ${n}.`, 'incomplete')
    if (q.type === 'choice') {
      answers[q.id] = int(v, `respuesta ${n}`, { min: 0, max: q.options.length - 1 })
      if (q.correct != null && answers[q.id] === q.correct) correct++
    } else {
      answers[q.id] = int(v, `respuesta ${n}`, { min: 1, max: SCALE_MAX })
    }
  }
  const total = gradableCount(survey)
  return { answers, correct, total, passed: correct >= survey.minCorrect }
}

/** Totales por pregunta para el panel. responses: [{ answers }] */
export function summarize(survey, responses) {
  return survey.questions.map((q) => {
    const values = responses.map((r) => r.answers[q.id]).filter((v) => v != null)
    const base = { id: q.id, type: q.type, text: q.text, answered: values.length }
    if (q.type === 'choice') {
      return { ...base, correct: q.correct, options: q.options.map((label, i) => ({ label, count: values.filter((v) => v === i).length })) }
    }
    if (q.type === 'scale') {
      const counts = Array.from({ length: SCALE_MAX }, (_, i) => values.filter((v) => v === i + 1).length)
      return { ...base, counts, average: values.length ? values.reduce((a, b) => a + b, 0) / values.length : null }
    }
    return base
  })
}
