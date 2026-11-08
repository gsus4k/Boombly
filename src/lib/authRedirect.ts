function optionalParams(source: string) {
  const params = new URLSearchParams(source)
  return {
    type: params.get('type') ?? undefined,
    message: params.get('message') ?? undefined,
    error: params.get('error') ?? undefined,
    errorCode: params.get('error_code') ?? undefined,
    errorDescription: params.get('error_description') ?? undefined,
  }
}

const hashParams = optionalParams(window.location.hash.replace(/^#/, ''))
const searchParams = optionalParams(window.location.search)

export const authRedirect = {
  type: hashParams.type ?? searchParams.type,
  message: hashParams.message ?? searchParams.message,
  error: hashParams.error ?? searchParams.error,
  errorCode: hashParams.errorCode ?? searchParams.errorCode,
  errorDescription: hashParams.errorDescription ?? searchParams.errorDescription,
}
