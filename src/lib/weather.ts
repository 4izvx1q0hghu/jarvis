import { create } from 'zustand'

/**
 * Weather and place for the HUD chip, and so Danya knows where you are.
 *
 * Location is asked for only when the user taps the weather chip, and the
 * coordinates and nearest place name stay in this browser's localStorage.
 * Weather comes from Open-Meteo and the place name from BigDataCloud's free
 * reverse geocoder — both free, no key, CORS-enabled.
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

/** From a tap on the chip: ask for location once, then remember it. */
export function enableWeather(): void {
  if (!('geolocation' in navigator)) return
  useWeather.setState({ asking: true })
  navigator.geolocation.getCurrentPosition(
    async (pos) => {
      const lat = Number(pos.coords.latitude.toFixed(3))
      const lon = Number(pos.coords.longitude.toFixed(3))
      let name = ''
      try {
        const res = await fetch(
          `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=en`,
        )
        const geo = (await res.json()) as { city?: string; locality?: string; countryName?: string }
        name = [geo.city || geo.locality, geo.countryName].filter(Boolean).join(', ')
      } catch {
        /* the weather still works without a name */
      }
      const place = { lat, lon, name }
      try {
        localStorage.setItem(KEY, JSON.stringify(place))
      } catch {
        /* storage blocked: weather for this visit only */
      }
      useWeather.setState({ asking: false })
      void fetchWeather(place)
    },
    () => useWeather.setState({ asking: false }),
    { timeout: 15000, maximumAge: 3_600_000 },
  )
}
