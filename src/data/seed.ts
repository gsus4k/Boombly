import type { Category, Restaurant } from './types'

export const CATEGORIES: Category[] = [
  { id: 'all', label: 'Todo', emoji: '✨' },
  { id: 'burgers', label: 'Burgers', emoji: '🍔' },
  { id: 'pizza', label: 'Pizza', emoji: '🍕' },
  { id: 'sushi', label: 'Sushi', emoji: '🍣' },
  { id: 'tacos', label: 'Tacos', emoji: '🌮' },
  { id: 'ramen', label: 'Ramen', emoji: '🍜' },
  { id: 'desserts', label: 'Dulces', emoji: '🍩' },
  { id: 'drinks', label: 'Bebidas', emoji: '🧃' },
]

export const TAGS = ['MÁS PEDIDO', 'NUEVO', 'TOP RATED', 'OFERTA', 'POPULAR']

const items = (names: string[]) => names.map(name => ({ name, price: 4.99 }))
const u = (id: string) => `https://images.unsplash.com/photo-${id}?w=600&h=400&fit=crop&auto=format`

export const SEED_RESTAURANTS: Restaurant[] = [
  { id: 'r1', name: 'Boom Burger Co.', category: 'burgers', rating: 4.9, time: '15–25 min', deliveryFee: 0, tag: 'MÁS PEDIDO', img: u('1651981101695-219fa3653bf1'), items: items(['Doble Smash', 'BBQ Clásico', 'Mushroom Swiss']), active: true, createdAt: 1 },
  { id: 'r2', name: 'Fuego Pizza', category: 'pizza', rating: 4.8, time: '20–35 min', deliveryFee: 0.5, tag: 'NUEVO', img: u('1622257892554-c162e47a3a5e'), items: items(['Margherita', 'Pepperoni Blast', 'Veggie Supreme']), active: true, createdAt: 2 },
  { id: 'r3', name: 'Sakura Rolls', category: 'sushi', rating: 4.7, time: '25–40 min', deliveryFee: 1, tag: 'TOP RATED', img: u('1579871494447-9811cf80d66c'), items: items(['Dragon Roll', 'Salmon Nigiri', 'Volcano Roll']), active: true, createdAt: 3 },
  { id: 'r4', name: 'El Cartel Tacos', category: 'tacos', rating: 4.6, time: '15–30 min', deliveryFee: 0, tag: 'OFERTA', img: u('1700513971603-eda40374ba0a'), items: items(['Al Pastor', 'Carnitas', 'Birria']), active: true, createdAt: 4 },
  { id: 'r5', name: 'Ramen House', category: 'ramen', rating: 4.8, time: '30–45 min', deliveryFee: 0.5, tag: 'POPULAR', img: u('1558220831-9ad8f955fb9b'), items: items(['Tonkotsu', 'Shoyu', 'Miso Spicy']), active: true, createdAt: 5 },
  { id: 'r6', name: "Rocco's Pizza", category: 'pizza', rating: 4.5, time: '20–30 min', deliveryFee: 0, tag: null, img: u('1770334597607-793046ac75d1'), items: items(['Cuatro Quesos', 'Prosciutto', 'Calabresa']), active: true, createdAt: 6 },
]
