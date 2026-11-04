"""Guerra Orbital: servidor autoritativo para partidas privadas WebSocket."""
import asyncio
import json
import os
import random
import secrets
import string
import time
from dataclasses import dataclass, field
from pathlib import Path

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

ROOT = Path(__file__).parent
app = FastAPI(title="Guerra Orbital")
app.mount("/static", StaticFiles(directory=ROOT / "static"), name="static")

SIZE = 10
SHIP_SIZES = [5, 4, 3, 2, 1]
COSTS = {"simple": 2, "shield": 3, "surprise": 5, "sweep": 6, "blast": 8}
ROOMS = {}
ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"


@dataclass
class Player:
    token: str
    name: str
    ws: WebSocket | None = None
    ships: list[list[tuple[int, int]]] = field(default_factory=list)
    shots: set[tuple[int, int]] = field(default_factory=set)  # attacks made by this player
    energy: int = 5
    shield: tuple[int, int] | None = None
    turns: int = 0
    ready: bool = False

    def cells(self):
        return {cell for ship in self.ships for cell in ship}


@dataclass
class Room:
    code: str
    players: list[Player] = field(default_factory=list)
    phase: str = "lobby"
    current: int | None = None
    winner: int | None = None
    last_event: dict | None = None
    updated: float = field(default_factory=time.monotonic)
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)


def valid_coord(raw):
    if not isinstance(raw, (list, tuple)) or len(raw) != 2:
        raise ValueError("Selecciona una casilla válida.")
    r, c = raw
    if type(r) is not int or type(c) is not int or not (0 <= r < SIZE and 0 <= c < SIZE):
        raise ValueError("Las coordenadas deben estar entre 0 y 9.")
    return r, c


def parse_ships(raw):
    if not isinstance(raw, list) or len(raw) != 5:
        raise ValueError("Coloca exactamente cinco satélites.")
    out = []
    occupied = set()
    for expected, shape in zip(SHIP_SIZES, raw):
        if not isinstance(shape, list) or len(shape) != expected:
            raise ValueError("Los satélites deben medir 5, 4, 3, 2 y 1 casillas.")
        cells = [valid_coord(cell) for cell in shape]
        if len(set(cells)) != expected or any(cell in occupied for cell in cells):
            raise ValueError("Los satélites no pueden solaparse.")
        rows = {r for r, _ in cells}
        cols = {c for _, c in cells}
        if not ((len(rows) == 1 and sorted(c for _, c in cells) == list(range(min(cols), min(cols) + expected)))
                or (len(cols) == 1 and sorted(r for r, _ in cells) == list(range(min(rows), min(rows) + expected)))):
            raise ValueError("Coloca los satélites en línea recta.")
        occupied.update(cells)
        out.append(cells)
    return out


def state(room, i):
    p = room.players[i]
    enemy = room.players[1 - i] if len(room.players) == 2 else None
    own_hits = enemy.shots & p.cells() if enemy else set()
    enemy_hits = p.shots & enemy.cells() if enemy else set()
    own_misses = enemy.shots - p.cells() if enemy else set()
    enemy_misses = p.shots - enemy.cells() if enemy else set()
    sunk_own = sum(all(cell in own_hits for cell in ship) for ship in p.ships)
    sunk_enemy = sum(all(cell in enemy_hits for cell in ship) for ship in enemy.ships) if enemy else 0
    return {
        "type": "state", "room": room.code, "phase": room.phase,
        "you": i, "name": p.name,
        "players": [{"name": x.name, "online": x.ws is not None, "ready": x.ready} for x in room.players],
        "turn": room.current, "winner": room.winner, "energy": p.energy,
        "enemyEnergy": enemy.energy if enemy else None,
        "ships": p.ships, "myHits": sorted(own_hits), "myMisses": sorted(own_misses),
        "enemyHits": sorted(enemy_hits), "enemyMisses": sorted(enemy_misses),
        "shield": list(p.shield) if p.shield else None,
        "sunkOwn": sunk_own, "sunkEnemy": sunk_enemy,
        "lastEvent": room.last_event,
    }


async def notify(room):
    for i, p in enumerate(room.players):
        if p.ws:
            try:
                await p.ws.send_json(state(room, i))
            except Exception:
                p.ws = None


async def send_error(ws, msg):
    await ws.send_json({"type": "error", "message": str(msg)})


def sweep_cells(action, coord):
    r, c = coord
    if action in ("simple", "surprise"):
        return [coord]
    if action == "sweep":
        if c > 7:
            raise ValueError("El barrido necesita tres casillas horizontales (columna inicial 0–7).")
        return [(r, c + j) for j in range(3)]
    if action == "blast":
        if r > 8 or c > 8:
            raise ValueError("La explosión 2×2 debe comenzar entre las filas y columnas 0–8.")
        return [(r, c), (r, c + 1), (r + 1, c), (r + 1, c + 1)]
    raise ValueError("Acción desconocida.")


def apply_action(room, who, data):
    if room.phase != "battle" or room.current != who:
        raise ValueError("Todavía no es tu turno.")
    p, enemy = room.players[who], room.players[1 - who]
    if not enemy.ws:
        raise ValueError("El rival está desconectado. Espera a que vuelva.")
    action = data.get("action")
    if action not in COSTS:
        raise ValueError("Elige una acción disponible.")
    cost = COSTS[action]
    if p.energy < cost:
        raise ValueError("No tienes energía suficiente para esta acción.")
    coord = valid_coord(data.get("cell"))
    results = []
    if action == "shield":
        if coord in (enemy.shots & p.cells()):
            raise ValueError("No puedes proteger un sector destruido.")
        p.shield = coord
        results.append({"cell": list(coord), "kind": "shield"})
    else:
        targets = sweep_cells(action, coord)
        if coord in p.shots:
            raise ValueError("La casilla inicial ya ha sido atacada.")
        if action == "surprise":
            candidates = [(r, c) for r in range(10) for c in range(10)
                          if (r, c) not in p.shots and (r, c) != coord]
            if candidates:
                targets.append(random.choice(candidates))
        for cell in targets:
            if cell in p.shots:
                results.append({"cell": list(cell), "kind": "already"})
            elif enemy.shield == cell:
                results.append({"cell": list(cell), "kind": "blocked"})
            else:
                p.shots.add(cell)
                results.append({"cell": list(cell), "kind": "hit" if cell in enemy.cells() else "miss"})
    p.energy -= cost
    p.turns += 1
    room.last_event = {"by": who, "action": action, "results": results, "at": time.time()}
    if enemy.cells() <= p.shots:
        room.winner = who
        room.phase = "finished"
    else:
        # El escudo del jugador que acaba de recibir el ataque caduca ahora.
        enemy.shield = None
        room.current = 1 - who
        # Se ganan 3 unidades al comenzar cada turno, excepto el primero de cada jugador.
        if enemy.turns > 0:
            enemy.energy += 3
    room.updated = time.monotonic()


def new_code():
    for _ in range(100):
        code = "".join(secrets.choice(ALPHABET) for _ in range(6))
        if code not in ROOMS:
            return code
    raise RuntimeError("No quedan salas disponibles")


@app.get("/")
async def index():
    return FileResponse(ROOT / "static" / "index.html")


@app.get("/health")
async def health():
    return {"ok": True, "rooms": len(ROOMS)}


@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    await ws.accept()
    room = None
    player = None
    try:
        while True:
            try:
                data = await ws.receive_json()
                if not isinstance(data, dict):
                    raise ValueError("Mensaje incorrecto.")
                kind = data.get("type")
                if kind == "hello":
                    if room:
                        raise ValueError("Ya estás en una sala.")
                    code = str(data.get("code") or "").strip().upper()
                    token = str(data.get("token") or "")[:100]
                    name = str(data.get("name") or "Comandante").strip()[:22] or "Comandante"
                    if code and code not in ROOMS:
                        raise ValueError("No existe ninguna sala con ese código.")
                    if not code:
                        code = new_code()
                        ROOMS[code] = Room(code)
                    candidate = ROOMS[code]
                    async with candidate.lock:
                        reconnect = next((x for x in candidate.players if x.token == token and token), None)
                        if reconnect:
                            # Desvincular la conexión antigua si existiera.
                            if reconnect.ws and reconnect.ws is not ws:
                                try:
                                    await reconnect.ws.close(code=4000)
                                except Exception:
                                    pass
                            player = reconnect
                            player.ws = ws
                        elif len(candidate.players) >= 2 or candidate.phase != "lobby":
                            raise ValueError("La sala está completa o la partida ya ha empezado.")
                        else:
                            player = Player(token=secrets.token_urlsafe(24), name=name, ws=ws)
                            candidate.players.append(player)
                        room = candidate
                        room.updated = time.monotonic()
                        await ws.send_json({"type": "joined", "room": code, "token": player.token})
                        await notify(room)
                elif not room or not player:
                    raise ValueError("Primero tienes que crear o unirte a una sala.")
                else:
                    async with room.lock:
                        i = room.players.index(player)
                        if kind == "deploy":
                            if room.phase != "lobby":
                                raise ValueError("La partida ya ha comenzado.")
                            player.ships = parse_ships(data.get("ships"))
                            player.ready = True
                            if len(room.players) == 2 and all(x.ready for x in room.players):
                                room.phase = "battle"
                                room.current = random.randrange(2)
                                room.last_event = None
                            await notify(room)
                        elif kind == "action":
                            apply_action(room, i, data)
                            await notify(room)
                        elif kind == "ping":
                            await ws.send_json({"type": "pong"})
                        else:
                            raise ValueError("Operación desconocida.")
            except (ValueError, TypeError) as exc:
                await send_error(ws, str(exc))
    except WebSocketDisconnect:
        pass
    except Exception:
        pass
    finally:
        if room and player:
            async with room.lock:
                if player.ws is ws:
                    player.ws = None
                    room.updated = time.monotonic()
                    await notify(room)


@app.on_event("startup")
async def startup_cleanup():
    async def cleanup():
        while True:
            await asyncio.sleep(3600)
            now = time.monotonic()
            for code, room in list(ROOMS.items()):
                if now - room.updated > 6 * 3600 and all(p.ws is None for p in room.players):
                    ROOMS.pop(code, None)
    asyncio.create_task(cleanup())


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=int(os.getenv("PORT", "8000")))
