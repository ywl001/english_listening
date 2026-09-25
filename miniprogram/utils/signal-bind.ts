import { effect, Signal } from '@preact/signals-core'
export function bindSignal<T>(page: any, signal: Signal<T>, dataKey: string, onChange?: (value: T) => void) {
  return effect(() => {
    const value = signal.value
    page.setData({ [dataKey]: value })
    onChange?.(value)
  })
}