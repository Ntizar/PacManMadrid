# 🎮 Madrid Pacman Traffic

Visualización de tráfico en tiempo real (simulado) de los autobuses EMT de Madrid con estética retro de Pacman.

## 🚀 Características

- **Datos GTFS reales** de la EMT Madrid
- **Estética Pacman**: fondo oscuro, líneas neón, fantasmas como buses
- **Simulación en tiempo real**: los buses recorren sus rutas
- **Controles de velocidad**: acelera o frena la simulación
- **Interactivo**: haz clic en los buses para ver información de la línea

## 📦 Instalación

```bash
# Instalar dependencias
npm install

# Configurar Mapbox (opcional pero recomendado)
# Copia .env.example a .env y añade tu token de Mapbox
cp .env.example .env

# Iniciar servidor de desarrollo
npm run dev
```

## 🗺️ Configuración de Mapbox

Para obtener la mejor experiencia visual, necesitas un token de Mapbox (gratuito):

1. Ve a [Mapbox](https://account.mapbox.com/access-tokens/)
2. Crea una cuenta gratuita
3. Copia tu token público
4. Edita el archivo `src/components/PacmanMap.jsx` y reemplaza el token

## 🎨 Personalización

### Colores de los fantasmas
Edita `src/utils/busSimulation.js`:

```javascript
export const GHOST_COLORS = [
  '#FF0000', // Blinky (rojo)
  '#FFB8FF', // Pinky (rosa)
  '#00FFFF', // Inky (cyan)
  '#FFB852', // Clyde (naranja)
];
```

## 🛠️ Tecnologías

- **React + Vite** - Framework y bundler
- **Mapbox GL JS** - Renderizado de mapas
- **Turf.js** - Cálculos geoespaciales
- **PapaParse** - Parseo de CSV/GTFS

## 🎯 Controles

| Control | Acción |
|---------|--------|
| Scroll | Zoom in/out |
| Click + Arrastrar | Mover mapa |
| Click en bus | Ver info de línea |
| Botones 0.5x-10x | Velocidad simulación |
| Play/Pausa | Iniciar/detener |

## 📊 Datos GTFS

Los datos provienen de la EMT Madrid e incluyen ~236 líneas de autobús.

---

🎮 *READY PLAYER ONE* 🚌
