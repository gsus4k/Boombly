import { useCallback, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useDatosEnVivo } from '../lib/useDatosEnVivo'

export type Categoria = { id_categoria: number; nombre: string; emoji: string | null }

export function useCategories() {
  const [categories, setCategories] = useState<Categoria[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const reload = useCallback(async () => {
    try {
      const { data, error: queryError } = await supabase
        .from('categoria')
        .select('id_categoria, nombre, emoji')
        .order('id_categoria')
      if (queryError) throw queryError

      setError('')
      setCategories(data ?? [])
    } catch (queryError) {
      setError(queryError instanceof Error ? queryError.message : String(queryError))
      throw queryError
    } finally {
      setLoading(false)
    }
  }, [])

  useDatosEnVivo(reload, ['categoria'])

  return { categories, loading, error, reload }
}
