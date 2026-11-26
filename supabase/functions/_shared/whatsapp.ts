// Envío de WhatsApp por Twilio, compartido entre Edge Functions.
// Secrets: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_WHATSAPP_FROM (ej: whatsapp:+14155238886)
// Nunca lanza excepciones ni imprime credenciales: siempre devuelve { ok, sid, error }.

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const TW_SID = Deno.env.get('TWILIO_ACCOUNT_SID') ?? ''
const TW_TOKEN = Deno.env.get('TWILIO_AUTH_TOKEN') ?? ''
const TW_FROM_RAW = Deno.env.get('TWILIO_WHATSAPP_FROM') ?? ''
const TW_FROM = TW_FROM_RAW.startsWith('whatsapp:') ? TW_FROM_RAW : `whatsapp:${TW_FROM_RAW}`

export type ResultadoWhatsApp = { ok: boolean; sid: string | null; error: string | null }

export type MensajeWhatsApp = {
  telefono: string // como en la BD: 584121234567
  variables?: Record<string, string> // {"1": "...", "2": "..."} para la plantilla
  contentSid?: string // plantilla aprobada; si falta se usa el modo Sandbox (texto libre)
  cuerpoSandbox: string
  mediaUrl?: string | null
}

// Twilio rechaza variables con saltos de línea, tabulaciones, más de 3 espacios seguidos o vacías.
export function limpiarVariable(valor: unknown): string {
  const limpio = String(valor ?? '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/ {4,}/g, '   ')
    .trim()
    .slice(0, 900)
    .trim()
  return limpio === '' ? '-' : limpio
}

export async function enviarWhatsApp({ telefono, variables, contentSid, cuerpoSandbox, mediaUrl }: MensajeWhatsApp): Promise<ResultadoWhatsApp> {
  try {
    if (!TW_SID || !TW_TOKEN || !TW_FROM_RAW) {
      return { ok: false, sid: null, error: 'WhatsApp no configurado: faltan TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN o TWILIO_WHATSAPP_FROM' }
    }
    const digitos = String(telefono ?? '').replace(/\D/g, '')
    if (!digitos) return { ok: false, sid: null, error: 'Teléfono de destino vacío' }

    const params = new URLSearchParams({ From: TW_FROM, To: `whatsapp:+${digitos}` })
    if (contentSid) {
      const vars: Record<string, string> = {}
      for (const [k, v] of Object.entries(variables ?? {})) vars[k] = limpiarVariable(v)
      params.set('ContentSid', contentSid)
      params.set('ContentVariables', JSON.stringify(vars))
    } else {
      params.set('Body', cuerpoSandbox)
      if (mediaUrl) params.set('MediaUrl', mediaUrl)
    }
    params.set('StatusCallback', `${SUPABASE_URL}/functions/v1/estado-whatsapp`)

    const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${TW_SID}/Messages.json`, {
      method: 'POST',
      headers: { Authorization: 'Basic ' + btoa(`${TW_SID}:${TW_TOKEN}`), 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params,
      signal: AbortSignal.timeout(15000),
    })
    const j = await r.json().catch(() => ({}))
    if (!r.ok) return { ok: false, sid: (j?.sid as string | undefined) ?? null, error: `${j?.code ?? r.status}: ${j?.message ?? 'error al enviar'}` }
    return { ok: true, sid: (j?.sid as string | undefined) ?? null, error: null }
  } catch (e) {
    return { ok: false, sid: null, error: `red: ${e instanceof Error ? e.message : 'error desconocido'}` }
  }
}
