import { Link, useParams } from 'react-router'
import { getSurveyResults } from '../../api/admin'
import { useAsync } from '../../shared/useAsync'
import { ErrorBox, Spinner } from '../quest/ui'
import { useEventAdmin } from './AdminContext'

/** Lo que respondio una persona a una pregunta, como texto. */
function answerText(q, value) {
  if (value == null) return ''
  return q.type === 'choice' ? (q.options[value] ?? '') : String(value)
}

function downloadCsv(name, questions, responses) {
  const cell = (v) => `"${String(v ?? '').replaceAll('"', '""')}"`
  const head = ['Nombre', 'Rama', 'Aciertos', 'XP', 'Fecha', ...questions.map((q) => q.text)]
  const rows = responses.map((r) => [r.alias, r.team, r.correct, r.pointsAwarded, r.createdAt, ...questions.map((q) => answerText(q, r.answers[q.id]))])
  // BOM: sin el, Excel muestra mal las tildes.
  const csv = '﻿' + [head, ...rows].map((row) => row.map(cell).join(',')).join('\r\n')
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  a.download = `${name}.csv`
  a.click()
  URL.revokeObjectURL(a.href)
}

function Bar({ label, count, total, mark }) {
  const pct = total ? Math.round((count / total) * 100) : 0
  return (
    <div className="survey-bar">
      <span className="survey-bar-label">
        {label} {mark && <strong className="ok-text">✓ correcta</strong>}
      </span>
      <span className="inline-bar" aria-hidden="true">
        <span style={{ width: `${pct}%` }} />
      </span>
      <span className="survey-bar-value">
        {count} · {pct} %
      </span>
    </div>
  )
}

export default function SurveyResults() {
  const { challengeId } = useParams()
  const { event } = useEventAdmin()
  const { data, error, loading, reload } = useAsync(() => getSurveyResults(challengeId), [challengeId])
  const base = `/admin/e/${event.id}`

  if (loading && !data) return <Spinner />
  if (error) return <ErrorBox error={error} retry={reload} />
  const { challenge, survey, summary, responses } = data
  const gradable = survey.questions.filter((q) => q.correct != null).length

  return (
    <section className="admin-page">
      <Link to={`${base}/retos/${challenge.id}`} className="muted small">
        ← {challenge.title}
      </Link>
      <div className="toolbar">
        <h2>
          {challenge.icon} Resultados ({responses.length})
        </h2>
        <div className="row">
          <button className="btn" onClick={reload}>
            Actualizar
          </button>
          <button className="btn primary" disabled={!responses.length} onClick={() => downloadCsv(challenge.title, survey.questions, responses)}>
            Descargar CSV
          </button>
        </div>
      </div>
      {!responses.length && <p className="empty">Todavía nadie respondió esta encuesta.</p>}

      {summary.map((q, i) => (
        <div key={q.id} className="card">
          <h3>
            {i + 1}. {q.text}
          </h3>
          {q.type === 'choice' &&
            q.options.map((o, k) => <Bar key={k} label={o.label} count={o.count} total={q.answered} mark={q.correct === k} />)}
          {q.type === 'scale' && (
            <>
              <p className="muted small">Promedio: {q.average == null ? '—' : q.average.toFixed(1)} de 5</p>
              {q.counts.map((count, k) => (
                <Bar key={k} label={k + 1} count={count} total={q.answered} />
              ))}
            </>
          )}
          {q.type === 'text' && (
            <ul className="survey-texts">
              {responses
                .filter((r) => r.answers[q.id])
                .map((r) => (
                  <li key={r.id}>
                    {r.answers[q.id]} <span className="muted small">· {r.alias}</span>
                  </li>
                ))}
              {!q.answered && <li className="muted">Sin respuestas.</li>}
            </ul>
          )}
        </div>
      ))}

      {responses.length > 0 && (
        <div className="card">
          <h3>Respuestas por persona</h3>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Nombre</th>
                  <th>{event.settings.teamLabel}</th>
                  {gradable > 0 && <th className="num">Aciertos</th>}
                  <th className="num">XP</th>
                  {survey.questions.map((q, i) => (
                    <th key={q.id} title={q.text}>
                      P{i + 1}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {responses.map((r) => (
                  <tr key={r.id}>
                    <td>{r.alias}</td>
                    <td>{r.team}</td>
                    {gradable > 0 && (
                      <td className="num">
                        {r.correct} / {gradable}
                      </td>
                    )}
                    <td className="num">{r.pointsAwarded}</td>
                    {survey.questions.map((q) => {
                      const v = r.answers[q.id]
                      const right = q.correct != null && v === q.correct
                      return (
                        <td key={q.id} className={q.correct == null || v == null ? '' : right ? 'ok-text' : 'bad-text'}>
                          {answerText(q, v)}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  )
}
