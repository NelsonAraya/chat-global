// Estado compartido en memoria: quién está conectado, en qué sala, e índices para buscar cuentas, salas y amistades.

module.exports = (ctx) => {
  const { data } = ctx;

  const users = new Map();
  const roomUsers = new Map();

  const socketIdByUsername = new Map(); // usuario conectado -> socket.id (evita recorrer a todos los conectados)
  const onlineSid = (username) => socketIdByUsername.get(username) || null;
  const isOnline = (username) => socketIdByUsername.has(username);

  const userEntry = (u) => ({ username: u.username, displayName: u.displayName || u.username, avatar: u.avatar || null });

  // ===== Índices en memoria =====
  // Buscar una cuenta o las amistades de alguien recorría la lista completa (2000 cuentas, decenas de miles de
  // amistades) en cada ingreso, salida y mensaje. Estos índices se rehacen solos cuando la lista cambia de
  // tamaño o se reemplaza (agregar = push, quitar = filter); los cambios dentro de una fila no los afectan.
  const lazyIndex = (getList, build) => {
    let list = null;
    let length = -1;
    let index = null;
    return () => {
      const current = getList();
      if (current !== list || current.length !== length) {
        list = current;
        length = current.length;
        index = build(current);
      }
      return index;
    };
  };
  const usersIndex = lazyIndex(() => data.users, list => new Map(list.map(u => [u.username, u])));
  const findUser = (username) => (typeof username === 'string' ? usersIndex().get(username) : undefined);

  // Salas por nombre: se buscan varias veces por cada mensaje, entrada o reacción.
  const roomsIndex = lazyIndex(() => data.rooms, list => new Map(list.map(r => [r.name, r])));
  const findRoom = (name) => roomsIndex().get(name);

  const friendsIndex = lazyIndex(() => data.friends, list => {
    const byUser = new Map();
    const add = (username, row) => {
      if (!byUser.has(username)) byUser.set(username, []);
      byUser.get(username).push(row);
    };
    for (const f of list) {
      add(f.requester, f);
      if (f.recipient !== f.requester) add(f.recipient, f);
    }
    return byUser;
  });
  const friendRowsOf = (username) => friendsIndex().get(username) || [];

  // Las salas globales (p. ej. "general") pueden tener a las 2000 personas conectadas: no se envía ni se muestra
  // quiénes (ni cuántos) están en ellas. Así no viaja una lista de ~200 KB a cada persona que entra, ni se
  // avisa a todos cada entrada y salida.
  const isGlobalRoom = (roomName) => {
    const room = findRoom(roomName);
    return !!room && !room.department;
  };

  const HISTORY_PAGE_SIZE = 50;

  const emailInUse = (email, exceptUsername) =>
    data.users.some(u => u.username !== exceptUsername && u.email && u.email.toLowerCase() === email);

  const userPublicInfo = (username) => {
    const u = findUser(username);
    return { username, displayName: u?.displayName || username, avatar: u?.avatar || null };
  };

  const userCard = (username) => {
    const r = findUser(username);
    return { username, displayName: r?.displayName || username, avatar: r?.avatar || null };
  };

  const departmentOptions = (names) => names.map(n => {
    const rec = data.departments.find(d => d.name === n);
    return { name: n, displayName: rec?.displayName || n };
  });

  Object.assign(ctx, { users, roomUsers, socketIdByUsername, onlineSid, isOnline, userEntry, lazyIndex, findUser,
    findRoom, friendRowsOf, isGlobalRoom, HISTORY_PAGE_SIZE, emailInUse, userPublicInfo, userCard, departmentOptions });
};
