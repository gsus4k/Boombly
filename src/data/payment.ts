import type { PagoMovilInfo } from './types'

// Datos por defecto: se usan cuando un restaurante no tiene los suyos configurados.
export const PAGO_MOVIL: PagoMovilInfo = {
  banco: 'Banco de Venezuela (0102)',
  telefono: '0412-0000000',
  cedula: 'V-00.000.000',
}

export type Payment = {
  method: 'pago_movil'
  reference: string
  proof: string // data URL (JPEG comprimido)
}

// Reduce la imagen para que quepa en localStorage. En un backend se subiría el archivo original.
export function compressImage(file: File, maxSide = 1000, quality = 0.75): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      const scale = Math.min(1, maxSide / Math.max(img.width, img.height))
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(img.width * scale)
      canvas.height = Math.round(img.height * scale)
      canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height)
      URL.revokeObjectURL(url)
      resolve(canvas.toDataURL('image/jpeg', quality))
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('No se pudo leer la imagen'))
    }
    img.src = url
  })
}
