# GUERRA ORBITAL — multijugador web

Versión jugable para **dos personas desde dispositivos diferentes**, con salas privadas y sincronización WebSocket. Se basa en las reglas de *Guerra Orbital* del proyecto de Fundamentos de IA.

## Ejecutar en tu ordenador

Necesitas Python 3.10 o superior.

```bash
cd guerra_orbital_web
python -m pip install -r requirements.txt
python server.py
```

Abre **http://localhost:8000** en el navegador. Si quieres probar dos jugadores en el mismo ordenador, abre una ventana normal y otra de incógnito (para tener tokens de sesión distintos).

## Jugar por Internet desde dos casas

1. Sube la carpeta del proyecto a un repositorio de **GitHub**.
2. En **https://render.com**, crea un nuevo **Web Service** conectando ese repositorio. Render puede leer el archivo `render.yaml` como Blueprint; si lo creas manualmente, usa:
   - **Build Command:** `pip install -r requirements.txt`
   - **Start Command:** `uvicorn server:app --host 0.0.0.0 --port $PORT`
   - **Plan:** el que elijas, sujeto a disponibilidad de Render.
3. Abre la URL que te dé Render (por ejemplo `https://tu-app.onrender.com`).
4. Jugador 1 elige **Crear partida** y usa **Copiar enlace**.
5. Jugador 2 abre el enlace y pulsa **Unirme** con el código ya introducido.
6. Los dos colocan sus satélites y confirman. Se elige aleatoriamente quién empieza.

**Importante:** la app tiene partidas **en memoria**, no guarda datos en base de datos. Si se reinicia el servidor, se pierden las partidas en curso. Usa **una sola instancia/worker** de servidor (sin escalado horizontal) para que ambas conexiones compartan la misma memoria. El servicio gratuito de algunos proveedores puede dormirse cuando no se usa, lo que interrumpe partidas. Para una demo se recomienda usar una instancia siempre activa.

## Reglas

- Tablero 10 × 10. Cada jugador coloca satélites rectos de longitudes 5, 4, 3, 2 y 1, sin solaparlos.
- Energía inicial: **5** por jugador; **+3** al comenzar cada turno *posterior al primero* de cada jugador. La energía no gastada se acumula.
- Exactamente una acción por turno:

  | Acción | Energía | Efecto |
  |---|---:|---|
  | Ataque simple | 2 | 1 casilla enemiga |
  | Escudo | 3 | 1 casilla propia protegida durante el próximo turno enemigo |
  | Sorpresa | 5 | 1 casilla elegida y 1 casilla aleatoria no atacada |
  | Barrido | 6 | 3 casillas consecutivas horizontales |
  | Explosión | 8 | bloque 2 × 2 |

- Los escudos solo cancelan la casilla protegida; no impiden el resto de un ataque múltiple.
- Gana quien impacta las **15 casillas** de los satélites del adversario.

## Controles

- Durante el despliegue: clic para colocar, tecla **R** para girar, botón **Aleatorio** para distribuir la flota.
- Durante el combate: clic en una acción o teclas **1–5**, después clic en el tablero enemigo (o en el propio si seleccionaste escudo).

## Estructura

- `server.py`: servidor FastAPI + WebSockets y lógica autoritativa.
- `static/index.html`: pantallas del juego.
- `static/style.css`: interfaz visual espacial y responsive.
- `static/app.js`: controles, gráficos del tablero, eventos y sincronización.
- `requirements.txt`: dependencias Python.
- `render.yaml`: configuración opcional para despliegue en Render.

### Consideraciones

No incluye chat, clasificación, cuentas, persistencia ni modo contra IA. Los códigos privados no sustituyen a un sistema de autenticación. Se permite recuperar una sesión con el token del navegador tras una desconexión mientras el servidor siga activo.
