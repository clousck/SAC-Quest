import { useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router'
import { getSurvey, submitSurvey } from '../../api/quest'
import { useAsync } from '../../shared/useAsync'
import { useQuest } from './QuestContext'
import { ChallengeIcon, ErrorBox, Screen, Spinner } from './ui'

/**
 * Encuesta de una charla: /e/:slug/s/:id?c=CODIGO. Tiene pantalla propia
 * (y no depende de la lista de retos) porque una encuesta secreta no aparece
 * en la lista hasta que se responde: se llega escaneando su QR.
 */
export default function SurveyScreen() {
  const { id } = useParams()
  const [params, setParams] = useSearchParams()
  const code = params.get('c') || ''
  const { slug, token, refresh } = useQuest()
  const navigate = useNavigate()
  const { data, error, loading, reload } = useAsync(() => getSurvey(slug, token, id, code), [slug, token, id, code])
  const [answers, setAnswers] = useState({})
  const [busy, setBusy] = useState(false)
  const [sendError, setSendError] = useState(null)
  const [manual, setManual] = useState('')

  const send = async (e) => {
    e.preventDefault()
    setBusy(true)
    setSendError(null)
    try {
      await submitSurvey(slug, token, id, { answers, code })
      await Promise.all([refresh(), reload()])
      window.scrollTo(0, 0)
    } catch (err) {
      setSendError(err)
    } finally {
      setBusy(false)
    }
  }

  if (loading && !data) return <Spinner />

  if (error) {
    return (
      <Screen back={`/e/${slug}`} title="Encuesta">
        <ErrorBox error={error} />
        {error.code === 'qr_required' && (
          <form
            className="form inline-form"
            onSubmit={(e) => {
              e.preventDefault()
              setParams({ c: manual.trim() }, { replace: true })
            }}
          >
            <label>
              ¿No puedes escanear? Escribe el código que está bajo el QR
              <input value={manual} onChange={(e) => setManual(e.target.value)} autoCapitalize="characters" autoComplete="off" required />
            </label>
            <button className="btn primary block">Abrir encuesta</button>
          </form>
        )}
      </Screen>
    )
  }

  const { challenge: c, questions } = data
  const ready = questions.every((q) => q.type === 'text' || answers[q.id] != null)

  return (
    <Screen back={`/e/${slug}`} className="challenge">
      <div className="ch-hero">
        <ChallengeIcon challenge={c} large />
        <h1>{c.title}</h1>
        <p className="chips">
          <span className="chip accent">+{data.answered ? data.result.pointsAwarded : c.points} XP</span>
          <span className="chip">📝 Encuesta</span>
        </p>
      </div>

      {data.answered ? (
        <Result data={data} />
      ) : (
        <>
          {c.description && <p className="ch-description">{c.description}</p>}
          <ul className="ch-facts">
            <li>☝️ Solo puedes responder una vez.</li>
            {c.survey.minCorrect > 0 && (
              <li>
                🎯 Necesitas {c.survey.minCorrect} de {c.survey.gradable} respuestas correctas para ganar los puntos.
              </li>
            )}
          </ul>
        </>
      )}

      <form className="survey" onSubmit={send}>
        {questions.map((q, i) => (
          <Question
            key={q.id}
            n={i + 1}
            q={q}
            value={data.answered ? data.answers[q.id] : answers[q.id]}
            readOnly={data.answered}
            onChange={(v) => setAnswers((a) => ({ ...a, [q.id]: v }))}
          />
        ))}
        <ErrorBox error={sendError} />
        {data.answered ? (
          <button type="button" className="btn primary block" onClick={() => navigate(`/e/${slug}`)}>
            Ver mis retos
          </button>
        ) : (
          <button className="btn primary block big" disabled={busy || !ready}>
            {busy ? 'Enviando…' : 'Enviar respuestas'}
          </button>
        )}
      </form>
    </Screen>
  )
}

function Result({ data }) {
  const { result, closed } = data
  return (
    <>
      <div className={result.passed ? 'result ok' : 'result'}>
        {result.passed ? `✅ ¡Listo! Ganaste ${result.pointsAwarded} XP.` : '📝 Respondida, pero no alcanzaste el mínimo de aciertos: 0 XP.'}
        {result.total > 0 && ` Acertaste ${result.correct} de ${result.total}.`}
      </div>
      {result.total > 0 && !closed && <p className="muted small center-text">Las respuestas correctas se podrán ver cuando la encuesta cierre.</p>}
    </>
  )
}

function Question({ n, q, value, readOnly, onChange }) {
  return (
    <fieldset className="survey-q" disabled={readOnly}>
      <legend>
        {n}. {q.text}
      </legend>
      {q.type === 'choice' &&
        q.options.map((label, i) => {
          // `correct` solo llega cuando la encuesta ya cerro.
          const mark = q.correct == null ? '' : i === q.correct ? ' right' : value === i ? ' wrong' : ''
          return (
            <label key={i} className={`survey-opt${value === i ? ' on' : ''}${mark}`}>
              <input type="radio" name={q.id} checked={value === i} onChange={() => onChange(i)} />
              <span>{label}</span>
              {mark === ' right' && <span aria-label="correcta">✓</span>}
            </label>
          )
        })}
      {q.type === 'scale' && (
        <div className="survey-scale" role="radiogroup">
          {Array.from({ length: q.max }, (_, i) => i + 1).map((v) => (
            <button type="button" key={v} role="radio" aria-checked={value === v} className={value === v ? 'on' : ''} onClick={() => onChange(v)}>
              {v}
            </button>
          ))}
        </div>
      )}
      {q.type === 'text' &&
        (readOnly ? (
          <p className="muted">{value || 'Sin respuesta'}</p>
        ) : (
          <textarea value={value ?? ''} onChange={(e) => onChange(e.target.value)} rows={2} maxLength={500} placeholder="Opcional" />
        ))}
    </fieldset>
  )
}
