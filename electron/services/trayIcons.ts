import { nativeImage, type NativeImage } from 'electron';
import type { TrayState } from './notificationTypes.js';

/**
 * Иконки системного трея (TASK-63, decision-13 п.2).
 *
 * PNG 32×32 вшиты в код как data URI, а не лежат файлами: трей поднимается до загрузки окна и
 * одинаково работает в dev и в упакованном приложении, где public/ уже внутри app.asar.
 * Кольцо с заливкой: idle — серый, working — синий, attention — жёлтый с красной точкой,
 * recording — красный (идёт запись голоса, TASK-83).
 * Генератор изображений — scripts/gen-tray-icons.mjs (запускается вручную при смене палитры).
 */

const PNG_BASE64: Record<TrayState, string> = {
  idle:
    "iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAABN0lEQVR42tVXMQ6DMAysRL/AmqVS/8LKGxgzwsgLWL0z+AdMfkDH" +
    "zn0DX2CiiuRWKHVIoFRJI52EguO7JI7jnE7/1gApB6QCkDQgtQzNffmvSM9McgOk2YMb256PIjfOxgBiG2aM/naphx3ENobNWwNI" +
    "V0B6HED+gvF13TLzNfIekEpAUoCUMRT39R4ReYiAYYVYBYxXK0KGkICTBuqdwRvui4/aeAS5R8QoHlGHcS85ruquqeruXtXdxDDf" +
    "jUNEHzQpR5JRFvGFyWYHzL+LEBMfyUqKfO/sPeRvEYGrkC8NCsGgFJZ9DkRjCSgF/4Vv/9WO2Yur4NgGvTRoBYPMEjBtEDBZAjLB" +
    "f5uUgOhbED0I4x7D6IkolVQc9zKKfh0nUZAkUZJFL0qTKMuTeJgk8zRL4nH6y/YE6XrIIJf85kMAAAAASUVORK5CYII=",
  working:
    "iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAABOElEQVR42tVXsQ2DMBCMRFagdRMpSzABLRP8AG4paViE6hdghpSp" +
    "MwMTIPENkaVPhJw3NoTIjqWTkHn/ne33+306/VsDpByQSkDSgNQwNPflvyI9M8kNkGYPbmx7PorcOBsCiG2YMfrbpe53ENvoN28N" +
    "IF0B6XEA+QvG13XLzNfIO0CqAEkBUsZQ3Nd5ROQhAvoVYhUwXq0I6UMCThqodwZvuC8+asMR5B4Rg3hEHcad5Lhox7pox3vRjhPD" +
    "fNcOEV3QpBxJRlnEFyabHTD/LkJMfCQrKfK9s/eQv0UErkK+NCgFg0pY9jkQtSWgEvyXvv1XO2YvroJjG/TSoBEMMkvAtEHAZAnI" +
    "BP9NUgKib0H0IIx7DKMnolRScdzLKPp1nERBkkRJFr0oTaIsT+JhkszTLInH6S/bEztkCm9To0vtAAAAAElFTkSuQmCC",
  attention:
    "iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAB60lEQVR42tVXMUvDQBQutEvp4JQ1S88OLqIOipPgLVlDf4A4ShAc" +
    "uhi6uXXXrQF/QlwEh1s6du4/EDoIaW2DlBsiV16gPC+Xu2tEG/ggXC7v+967d+/e1Wq79nBGHM6IxxkJOCN9QABjTj4vobSZUNpN" +
    "KA0B4r1pS9oAkhFnJCvBaHFz/pJQukwozRDEWGhKLoinGsRrLO7OMgkxxrNuqGNdYoH04USHPEeoIu9wRiYm5PxtP5t5lyYCltKc" +
    "AM9V5BFnxOeMuJyROsBd9k4HBuQ5ujIBsYLYLYoaZLqpgFCWcDLyoCxnthYAW21qQw4CulstQYH3kYwsHbZ66bA1ToetFWCcPu3d" +
    "F+x9vSQsKDIuIm4DcSbD5+3Bu234HR3vVeQ55lfHH2Xkolhtlu0a1HEswJeEPdPB/ProVbYcok6IYgX2vbL1d02938B48zCa+ReD" +
    "r8fDdbGSJjecaFhAHQlYGQhYoe1dl9jv/ysBlS8BEuAq60vVSSjmIgG+xL73K9sQew/2I4l9B0/auhDBt7ZG+EdFnY99KUZhL/E+" +
    "KOr7rA8jRTuH7QmOhskPViKsbdk2JGjNowIbsW4zatySwVik+G/yI/MrbUrVELY6NjeguALyWNvzKi4mKNuDqu6DRlczmNv408vp" +
    "zjzfPwRd9PLTgq8AAAAASUVORK5CYII=",
  recording:
    "iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAABMklEQVR42tVXMQrDMAwspF/I6qXQl3jJmnd4zZi3ZLoP5A0ZO/cN" +
    "2TIHBCkGtRRXjp00xa7hIDiy7mzLsnw6/VsjoCSgIsAQ0DIM95W/Ij0zyUDAEsDAtuejyK2zMYLYhR1jvl3qfgexi37z1hBwJeB+" +
    "APkT1td1y8zXyDsCagIUAQVDcV8XEFHGCOhXiFXEeLUipI8JOGmg2Rm88b74qI1HkAdEjOIR9Rh3kuNJ62bS+jZpPTPsd+MR0UVN" +
    "ypNklEN8YbLFA/vvIsTER7KSIj84+wD5S0TkKpTvBpVgUAvLvkSicQTUgv8qtP9qx+zFVfBsg3k3aAWDwhEwbxAwOwIKwX+blYDk" +
    "W5A8CNMew+SJKJdUnPYySn4dZ1GQZFGSJS9KsyjLs3iYZPM0y+Jx+sv2AHEQZ2dWoJSzAAAAAElFTkSuQmCC"
};

const cache = new Map<TrayState, NativeImage>();

/** Иконка состояния; результат кешируется — Tray.setImage вызывается на каждом событии шины. */
export function getTrayIcon(state: TrayState): NativeImage {
  const cached = cache.get(state);
  if (cached) return cached;
  const image = nativeImage.createFromDataURL(`data:image/png;base64,${PNG_BASE64[state]}`);
  cache.set(state, image);
  return image;
}
