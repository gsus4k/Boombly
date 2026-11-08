export function authRedirectOrigin() {
  const origin = new URL(window.location.origin)
  if (origin.hostname === 'localhost' || origin.hostname === '[::1]') {
    origin.hostname = '127.0.0.1'
  }
  return origin.origin
}
