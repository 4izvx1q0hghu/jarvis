import { create } from 'zustand'

/**
 * Weather and place for the HUD chip, and so Danya knows where you are.
 *
 * Location is asked for when Danya is powered up (a tap) or the weather chip
 * is tapped, then followed for as long as she is open, so the place she knows
 * and the weather stay right as you move. The coordinates and place name stay
 * in this browser's localStorage. Weather comes from Open-Meteo and the place
 * name from BigDataCloud's free reverse geocoder — both free, no key,
 * CORS-enabled.
 */

const KEY = 'danya.place'

type Place = { lat: number; lon: number; name: string }
export type Weather = { temp: number; code: number; place: string }

export const useWeather = create<{ weather: Weather | null; asking: boolean }>(() => ({
  weather: null,
  asking: false,
}))

function load(): Place | null {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? 'null') as Place | null
  } catch {
    return null
  }
}

export const savedPlace = (): string | undefined => load()?.name || undefined

/** An emoji for a WMO weather code. */
export function weatherIcon(code: number): string {
  if (code === 0) return '☀️'
  if (code <= 2) return '🌤️'
  if (code === 3) return '☁️'
  if (code <= 48) return '🌫️'
  if (code <= 67 || (code >= 80 && code <= 82)) return '🌧️'
  if (code <= 77 || code === 85 || code === 86) return '🌨️'
  return '⛈️'
}

async function fetchWeather(place: Place): Promise<void> {
  try {
    const res = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${place.lat}&longitude=${place.lon}&current=temperature_2m,weather_code`,
    )
    const data = (await res.json()) as { current?: { temperature_2m: number; weather_code: number } }
    if (data.current) {
      useWeather.setState({
        weather: { temp: Math.round(data.current.temperature_2m), code: data.current.weather_code, place: place.name },
      })
    }
  } catch {
    /* offline: the chip just stays as it was */
  }
}

/** On boot: show weather if the user already allowed location. */
export function refreshWeather(): void {
  const place = load()
  if (place) void fetchWeather(place)
}

/** Kilometres between two points (close enough at this scale). */
function km(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const x = (b.lon - a.lon) * Math.cos(((a.lat + b.lat) / 2) * (Math.PI / 180))
  const y = b.lat - a.lat
  return Math.sqrt(x * x + y * y) * 111.32
}

/** A new position: name the place and update the weather, unless it is
 *  within half a kilometre of the last one. */
async function located(pos: GeolocationPosition): Promise<void> {
  const lat = Number(pos.coords.latitude.toFixed(3))
  const lon = Number(pos.coords.longitude.toFixed(3))
  const last = load()
  useWeather.setState({ asking: false })
  if (last?.name && km(last, { lat, lon }) < 0.5) {
    if (!useWeather.getState().weather) void fetchWeather(last)
    return
  }
  let name = ''
  try {
    const res = await fetch(
      `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=en`,
    )
    const geo = (await res.json()) as { city?: string; locality?: string; countryName?: string }
    // "Bandar Sunway, Subang Jaya, Malaysia": the area, the town, the country.
    name = [...new Set([geo.locality, geo.city, geo.countryName].filter(Boolean))].join(', ')
  } catch {
    /* the weather still works without a name */
  }
  const place = { lat, lon, name: name || last?.name || '' }
  try {
    localStorage.setItem(KEY, JSON.stringify(place))
  } catch {
    /* storage blocked: weather for this visit only */
  }
  void fetchWeather(place)
}

let watching = false

/** Follow where the phone is for as long as Danya is open. Asks for location
 *  the first time, so call it from a tap. */
export function trackLocation(): void {
  if (watching || !('geolocation' in navigator)) return
  watching = true
  navigator.geolocation.watchPosition(
    (pos) => void located(pos),
    (err) => {
      useWeather.setState({ asking: false })
      // Refused: stop, and let a tap on the chip ask again.
      if (err.code === err.PERMISSION_DENIED) watching = false
    },
    { enableHighAccuracy: false, maximumAge: 120_000, timeout: 30_000 },
  )
}

/** From a tap on the chip: ask for location, then keep following it. */
export function enableWeather(): void {
  if (!('geolocation' in navigator)) return
  useWeather.setState({ asking: true })
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      void located(pos)
      trackLocation()
    },
    () => useWeather.setState({ asking: false }),
    { timeout: 15000, maximumAge: 600_000 },
  )
}
