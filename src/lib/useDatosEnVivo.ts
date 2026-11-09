import { useEffect } from 'react'
import { supabase } from './supabase'

export function useDatosEnVivo(cargar: () => Promise<void>, tablas: string[]) {
  const tablasKey = tablas.join('\u0000')

  useEffect(() => {
    let estadoCanal = ''
    let temporizador: number | undefined
    const nombresTablas = tablasKey ? tablasKey.split('\u0000') : []
    const canal = supabase.channel(`vivo-${tablas.join('-')}-${crypto.randomUUID()}`)

    const cargarConRegistro = async (operacion: string) => {
      try {
        await cargar()
      } catch (error) {
        console.error(`[vivo] ${operacion}`, error)
      }
    }

    const programar = () => {
      if (temporizador !== undefined) window.clearTimeout(temporizador)
      temporizador = window.setTimeout(() => {
        temporizador = undefined
        void cargarConRegistro('recargar por cambio remoto')
      }, 400)
    }

    for (const table of nombresTablas) {
      canal.on('postgres_changes', { event: '*', schema: 'public', table }, programar)
    }

    canal.subscribe((status, error) => {
      estadoCanal = status
      if (error) console.error('[vivo] suscribir canal', error)
    })

    const recargarAlVolver = () => {
      if (document.visibilityState === 'visible') {
        void cargarConRegistro('recargar al volver a la pestaña')
      }
    }
    const recargarAlEnfocar = () => {
      void cargarConRegistro('recargar al enfocar')
    }
    const recargarAlConectar = () => {
      void cargarConRegistro('recargar al conectar')
    }
    const respaldo = window.setInterval(() => {
      if (document.visibilityState === 'visible' && estadoCanal !== 'SUBSCRIBED') {
        void cargarConRegistro('recargar por respaldo')
      }
    }, 30_000)

    document.addEventListener('visibilitychange', recargarAlVolver)
    window.addEventListener('focus', recargarAlEnfocar)
    window.addEventListener('online', recargarAlConectar)
    void cargarConRegistro('carga inicial')

    return () => {
      if (temporizador !== undefined) window.clearTimeout(temporizador)
      window.clearInterval(respaldo)
      document.removeEventListener('visibilitychange', recargarAlVolver)
      window.removeEventListener('focus', recargarAlEnfocar)
      window.removeEventListener('online', recargarAlConectar)
      void supabase.removeChannel(canal)
    }
  }, [cargar, tablasKey])
}
