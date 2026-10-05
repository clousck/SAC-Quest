import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { mediaUrl } from '../../api/client'
import {
  createChallenge,
  deleteChallenge,
  deleteChallengeImage,
  getChallenge,
  listChallenges,
  regenerateQr,
  updateChallenge,
  uploadChallengeImage,
} from '../../api/admin'
import { prepareImage } from '../../shared/imageResize'
import { ErrorBox, Spinner, TYPE_EMOJI } from '../quest/ui'
import { useAdmin, useEventAdmin } from './AdminContext'
import QrImage, { checkpointUrl, fromLocalInput, toLocalInput } from './QrImage'

const EMPTY = {
  type: 'PHOTO',
  title: '',
  description: '',
  icon: '📷',
  points: 20,
  tier: 'normal',
  category: '',
  status: 'active',
  visibility: 'visible',
  availableFrom: '',
  availableUntil: '',
  maxCompletions: '',
  afterChallenges: [],
  minXp: '',
  survey: { qrOnly: true, minCorrect: 0, questions: [] },
}

const TYPES = [
  ['PHOTO', '📷 Foto', 'La persona toma una foto con la cámara del teléfono.'],
  ['AR', '🐱 AR con Watt', 'Abre la cámara con Watt y la foto resultante es la evidencia.'],
  ['QR', '📍 Checkpoint QR', 'Se completa escaneando un QR impreso. No lleva foto.'],
  ['TRIVIA', '📝 Encuesta', 'Preguntas sobre una charla. Se responde una sola vez y se corrige sola.'],
]

// Opcion del selector para un reto con puntos puestos a mano antes de existir los valores.
const CUSTOM = '__custom'

const ICONS = ['📷', '🤝', '🐱', '📍', '🎤', '🧑‍🤝‍🧑', '🌐', '💡', '⚡', '🏆', '🎯', '🔒', '🍕', '🎉', '🤖', '🔌']

function toForm(c) {
  return {
    type: c.type,
    title: c.title,
    description: c.description,
    icon: c.icon,
    points: c.points,
    // Sin valor: puntos puestos a mano (retos anteriores) o un reto sin XP.
    tier: c.tier ?? (c.points ? CUSTOM : ''),
    category: c.category,
    status: c.status,
    visibility: c.visibility,
    availableFrom: toLocalInput(c.availableFrom),
    availableUntil: toLocalInput(c.availableUntil),
    maxCompletions: c.maxCompletions ?? '',
    afterChallenges: c.unlockRule?.afterChallenges ?? [],
    minXp: c.unlockRule?.minXp ?? '',
    survey: c.config?.survey ?? EMPTY.survey,
  }
}

function toBody(f) {
  return {
    type: f.type,
    title: f.title,
    description: f.description,
    icon: f.icon,
    // Con un valor elegido, los puntos los pone el servidor.
    tier: f.tier && f.tier !== CUSTOM ? f.tier : null,
    points: f.tier === CUSTOM ? Number(f.points) || 0 : 0,
    category: f.category,
    status: f.status,
    visibility: f.visibility,
    availableFrom: fromLocalInput(f.availableFrom),
    availableUntil: fromLocalInput(f.availableUntil),
    maxCompletions: f.maxCompletions === '' ? null : Number(f.maxCompletions),
    unlockRule: { afterChallenges: f.afterChallenges, minXp: Number(f.minXp) || 0 },
    ...(f.type === 'TRIVIA' && { config: { survey: { ...f.survey, minCorrect: Number(f.survey.minCorrect) || 0 } } }),
  }
}

export default function ChallengeForm() {
  const { challengeId } = useParams()
  const { event } = useEventAdmin()
  const { isAdmin } = useAdmin()
  const navigate = useNavigate()
  const isNew = !challengeId
  // Un reto nuevo arranca con el segundo valor del evento (el "normal").
  const [form, setForm] = useState(() => ({ ...EMPTY, tier: (event.settings.pointTiers[1] ?? event.settings.pointTiers[0]).id }))
  const [challenge, setChallenge] = useState(null)
  const [others, setOthers] = useState([])
  const [loading, setLoading] = useState(!isNew)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [saved, setSaved] = useState(false)
  const imageInput = useRef(null)
  const base = `/admin/e/${event.id}`

  useEffect(() => {
    listChallenges(event.id).then((r) => setOthers(r.challenges.filter((c) => String(c.id) !== challengeId)))
    if (isNew) return
    getChallenge(challengeId)
      .then(({ challenge }) => {
        setChallenge(challenge)
        setForm(toForm(challenge))
      })
      .catch(setError)
      .finally(() => setLoading(false))
  }, [event.id, challengeId, isNew])

  const set = (key) => (e) => {
    const value = e.target.type === 'checkbox' ? e.target.checked : e.target.value
    setForm((f) => ({ ...f, [key]: value }))
    setSaved(false)
  }

  const save = async (e) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      if (isNew) {
        const { challenge } = await createChallenge(event.id, toBody(form))
        navigate(`${base}/retos/${challenge.id}`, { replace: true })
      } else {
        const { challenge } = await updateChallenge(challengeId, toBody(form))
        setChallenge(challenge)
        setSaved(true)
      }
    } catch (err) {
      setError(err)
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    const n = challenge.counts.approved + challenge.counts.pending
    const msg = n
      ? `Este reto tiene ${n} envíos. Borrarlo elimina sus fotos y los puntos ganados. ¿Seguro? (Para ocultarlo sin perder nada, desactívalo.)`
      : '¿Borrar este reto?'
    if (!window.confirm(msg)) return
    await deleteChallenge(challengeId)
    navigate(`${base}/retos`)
  }

  const onImage = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setBusy(true)
    try {
      const { photo } = await prepareImage(file)
      const { challenge } = await uploadChallengeImage(challengeId, photo)
      setChallenge(challenge)
    } catch (err) {
      setError(err)
    } finally {
      setBusy(false)
    }
  }

  if (loading) return <Spinner />
  const categories = [...new Set(others.map((c) => c.category).filter(Boolean))]
  const readOnly = !isAdmin

  return (
    <section className="admin-page narrow">
      <Link to={`${base}/retos`} className="muted small">
        ← Retos
      </Link>
      <h2>{isNew ? 'Nuevo reto' : form.title || 'Reto'}</h2>
      {readOnly && <p className="notice">Solo un administrador puede editar retos.</p>}

      <form className="card form" onSubmit={save}>
        <fieldset disabled={readOnly || busy}>
          <div className="type-picker">
            {TYPES.map(([value, label, help]) => (
              <label key={value} className={form.type === value ? 'on' : ''}>
                <input
                  type="radio"
                  name="type"
                  value={value}
                  checked={form.type === value}
                  onChange={() => {
                    // El icono acompaña al tipo mientras no se haya elegido otro a mano.
                    setForm((f) => ({ ...f, type: value, icon: Object.values(TYPE_EMOJI).includes(f.icon) ? TYPE_EMOJI[value] : f.icon }))
                    setSaved(false)
                  }}
                />
                <strong>{label}</strong>
                <small>{help}</small>
              </label>
            ))}
          </div>

          <label>
            Título
            <input value={form.title} onChange={set('title')} required minLength={2} maxLength={80} placeholder="Conoce una nueva Rama" />
          </label>
          <label>
            Descripción (lo que la persona tiene que hacer)
            <textarea
              value={form.description}
              onChange={set('description')}
              rows={3}
              maxLength={1000}
              placeholder="Encuentra a alguien de una Rama diferente y tómense una foto."
            />
          </label>

          <div className="form-grid">
            <label>
              Icono
              <input value={form.icon} onChange={set('icon')} maxLength={16} />
            </label>
            <label>
              Valor
              <select value={form.tier} onChange={set('tier')}>
                {event.settings.pointTiers.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} · {t.points} XP
                  </option>
                ))}
                <option value="">Sin XP (solo cuenta para la {event.settings.teamLabel})</option>
                {form.tier === CUSTOM && <option value={CUSTOM}>Actual · {form.points} XP</option>}
              </select>
            </label>
            <label>
              Categoría
              <input value={form.category} onChange={set('category')} list="categories" maxLength={40} placeholder="Networking" />
              <datalist id="categories">
                {categories.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </label>
          </div>
          <div className="icon-picker">
            {ICONS.map((i) => (
              <button type="button" key={i} className={form.icon === i ? 'on' : ''} onClick={() => setForm((f) => ({ ...f, icon: i }))}>
                {i}
              </button>
            ))}
          </div>

          <div className="form-grid">
            <label>
              Estado
              <select value={form.status} onChange={set('status')}>
                <option value="active">Activo (visible para participantes)</option>
                <option value="inactive">Inactivo (oculto)</option>
                <option value="draft">Borrador</option>
              </select>
            </label>
            <label>
              Visibilidad
              <select value={form.visibility} onChange={set('visibility')}>
                <option value="visible">Visible en la lista</option>
                <option value="secret">Secreto</option>
              </select>
            </label>
          </div>
          {form.visibility === 'secret' && (
            <p className="muted small">
              Un reto secreto no aparece en la lista hasta cumplir su condición de desbloqueo. Un checkpoint QR secreto sin
              condición aparece cuando alguien lo escanea.
            </p>
          )}

          <p className="muted small">
            {form.type === 'QR' && '⚡ Se aprueba automáticamente al escanear el QR: no pasa por moderación.'}
            {form.type === 'TRIVIA' && '⚡ Se corrige y aprueba sola. Cada persona puede responder una sola vez.'}
            {(form.type === 'PHOTO' || form.type === 'AR') && '👀 Un moderador revisa cada foto antes de sumar los puntos.'}
          </p>

          {form.type === 'TRIVIA' && (
            <SurveyEditor
              survey={form.survey}
              locked={!!challenge && challenge.counts.approved > 0}
              onChange={(survey) => {
                setForm((f) => ({ ...f, survey }))
                setSaved(false)
              }}
            />
          )}

          <details open={!!(form.availableFrom || form.availableUntil || form.maxCompletions)}>
            <summary>Horario y cupo</summary>
            <div className="form-grid">
              <label>
                Disponible desde
                <input type="datetime-local" value={form.availableFrom} onChange={set('availableFrom')} />
              </label>
              <label>
                Disponible hasta
                <input type="datetime-local" value={form.availableUntil} onChange={set('availableUntil')} />
              </label>
              <label>
                Límite de participantes
                <input type="number" min="1" value={form.maxCompletions} onChange={set('maxCompletions')} placeholder="Sin límite" />
              </label>
            </div>
          </details>

          <details open={!!(form.afterChallenges.length || form.minXp)}>
            <summary>Desbloqueo</summary>
            <p className="muted small">El reto aparece bloqueado (o escondido, si es secreto) hasta cumplir todo lo marcado.</p>
            <label>
              XP mínimo
              <input type="number" min="0" value={form.minXp} onChange={set('minXp')} placeholder="Sin mínimo" />
            </label>
            {others.length > 0 && <p className="muted small">Completar antes:</p>}
            <div className="check-list">
              {others.map((c) => (
                <label key={c.id} className="check">
                  <input
                    type="checkbox"
                    checked={form.afterChallenges.includes(c.id)}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        afterChallenges: e.target.checked
                          ? [...f.afterChallenges, c.id]
                          : f.afterChallenges.filter((x) => x !== c.id),
                      }))
                    }
                  />
                  <span>
                    {c.icon} {c.title}
                  </span>
                </label>
              ))}
            </div>
          </details>
        </fieldset>

        <ErrorBox error={error} />
        {!readOnly && (
          <div className="row">
            <button className="btn primary" disabled={busy}>
              {isNew ? 'Crear reto' : 'Guardar cambios'}
            </button>
            {saved && <span className="saved">✓ Guardado</span>}
          </div>
        )}
      </form>

      {!isNew && challenge && (
        <>
          <div className="card">
            <h3>Imagen del reto (opcional)</h3>
            <p className="muted small">Reemplaza al icono en la app. Se recomienda cuadrada.</p>
            {challenge.imageUrl && <img className="ch-image-preview" src={mediaUrl(challenge.imageUrl)} alt="" />}
            {isAdmin && (
              <div className="row">
                <input ref={imageInput} type="file" accept="image/*" hidden onChange={onImage} />
                <button className="btn" onClick={() => imageInput.current.click()} disabled={busy}>
                  {challenge.imageUrl ? 'Cambiar imagen' : 'Subir imagen'}
                </button>
                {challenge.imageUrl && (
                  <button className="btn" onClick={async () => setChallenge((await deleteChallengeImage(challenge.id)).challenge)}>
                    Quitar
                  </button>
                )}
              </div>
            )}
          </div>

          {challenge.type === 'TRIVIA' && (
            <div className="card">
              <h3>Respuestas</h3>
              <p className="muted small">
                {challenge.counts.approved} {challenge.counts.approved === 1 ? 'persona respondió' : 'personas respondieron'}. Para abrirla o
                cerrarla al momento, usa los botones de la lista de retos.
              </p>
              <Link className="btn" to={`${base}/retos/${challenge.id}/resultados`}>
                📊 Ver resultados
              </Link>
            </div>
          )}

          {(challenge.type === 'QR' || challenge.type === 'TRIVIA') && challenge.qrCode && (
            <div className="card qr-card">
              <h3>{challenge.type === 'QR' ? 'Código QR del checkpoint' : 'Código QR de la encuesta'}</h3>
              <QrImage value={checkpointUrl(event, challenge)} size={200} />
              <p className="code-text">{challenge.qrCode}</p>
              <p className="muted small break">{checkpointUrl(event, challenge)}</p>
              <div className="row">
                <Link className="btn" to={`${base}/imprimir?reto=${challenge.id}`}>
                  🖨️ Imprimir
                </Link>
                {isAdmin && (
                  <button
                    className="btn"
                    onClick={async () => {
                      if (!window.confirm('El QR impreso actual dejará de funcionar. ¿Generar uno nuevo?')) return
                      setChallenge((await regenerateQr(challenge.id)).challenge)
                    }}
                  >
                    Generar otro código
                  </button>
                )}
              </div>
            </div>
          )}

          {isAdmin && (
            <button className="btn danger" onClick={remove}>
              Borrar reto
            </button>
          )}
        </>
      )}
    </section>
  )
}

const QUESTION_KINDS = [
  ['choice', 'Opción única'],
  ['scale', 'Escala 1 a 5'],
  ['text', 'Texto corto'],
]

/** Preguntas de una encuesta. Con respuestas ya recibidas queda de solo lectura. */
function SurveyEditor({ survey, locked, onChange }) {
  const questions = survey.questions
  const setQ = (i, patch) => onChange({ ...survey, questions: questions.map((q, j) => (j === i ? { ...q, ...patch } : q)) })
  const gradable = questions.filter((q) => q.type === 'choice' && q.correct != null).length
  const add = (type) =>
    onChange({
      ...survey,
      questions: [...questions, type === 'choice' ? { type, text: '', options: ['', ''], correct: null } : { type, text: '' }],
    })
  const move = (i, delta) => {
    const next = [...questions]
    const [q] = next.splice(i, 1)
    next.splice(i + delta, 0, q)
    onChange({ ...survey, questions: next })
  }

  return (
    <div className="survey-editor">
      <h3>Preguntas</h3>
      {locked && <p className="notice">Esta encuesta ya tiene respuestas: las preguntas no se pueden cambiar. Para otra versión, crea una encuesta nueva.</p>}
      <fieldset disabled={locked}>
        {questions.map((q, i) => (
          <div key={i} className="survey-editor-q">
            <div className="row">
              <strong>{i + 1}.</strong>
              <select
                value={q.type}
                aria-label="Tipo de pregunta"
                onChange={(e) =>
                  setQ(i, e.target.value === 'choice' ? { type: 'choice', options: q.options ?? ['', ''], correct: q.correct ?? null } : { type: e.target.value })
                }
              >
                {QUESTION_KINDS.map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
              <button type="button" className="btn small" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Subir">
                ↑
              </button>
              <button type="button" className="btn small" disabled={i === questions.length - 1} onClick={() => move(i, 1)} aria-label="Bajar">
                ↓
              </button>
              <button type="button" className="btn small" onClick={() => onChange({ ...survey, questions: questions.filter((_, j) => j !== i) })}>
                Quitar
              </button>
            </div>
            <input value={q.text} onChange={(e) => setQ(i, { text: e.target.value })} placeholder="Escribe la pregunta" maxLength={300} required />
            {q.type === 'choice' && (
              <>
                {q.options.map((opt, k) => (
                  <div key={k} className="row survey-editor-opt">
                    <input
                      type="radio"
                      name={`correct-${i}`}
                      checked={q.correct === k}
                      onChange={() => setQ(i, { correct: k })}
                      aria-label="Marcar como correcta"
                    />
                    <input
                      value={opt}
                      onChange={(e) => setQ(i, { options: q.options.map((o, j) => (j === k ? e.target.value : o)) })}
                      placeholder={`Opción ${k + 1}`}
                      maxLength={120}
                      required
                    />
                    {q.options.length > 2 && (
                      <button
                        type="button"
                        className="btn small"
                        onClick={() =>
                          setQ(i, {
                            options: q.options.filter((_, j) => j !== k),
                            correct: q.correct === k ? null : q.correct > k ? q.correct - 1 : q.correct,
                          })
                        }
                      >
                        ✕
                      </button>
                    )}
                  </div>
                ))}
                <div className="row">
                  {q.options.length < 6 && (
                    <button type="button" className="btn small" onClick={() => setQ(i, { options: [...q.options, ''] })}>
                      + Opción
                    </button>
                  )}
                  {q.correct != null && (
                    <button type="button" className="btn small" onClick={() => setQ(i, { correct: null })}>
                      Sin respuesta correcta
                    </button>
                  )}
                  <span className="muted small">
                    {q.correct == null ? 'De opinión. Si es de conocimiento, marca el círculo de la opción correcta.' : `Correcta: opción ${q.correct + 1}`}
                  </span>
                </div>
              </>
            )}
          </div>
        ))}
        <div className="row">
          {QUESTION_KINDS.map(([v, l]) => (
            <button type="button" key={v} className="btn small" onClick={() => add(v)}>
              + {l}
            </button>
          ))}
        </div>
        {gradable > 0 && (
          <label>
            Aciertos mínimos para ganar los puntos (de {gradable}; 0 = basta con responder)
            <input
              type="number"
              min="0"
              max={gradable}
              value={survey.minCorrect}
              onChange={(e) => onChange({ ...survey, minCorrect: e.target.value })}
            />
          </label>
        )}
      </fieldset>
      <label className="check">
        <input type="checkbox" checked={survey.qrOnly} onChange={(e) => onChange({ ...survey, qrOnly: e.target.checked })} />
        <span>Solo se puede responder escaneando su QR (para proyectarlo al final de la charla)</span>
      </label>
    </div>
  )
}
