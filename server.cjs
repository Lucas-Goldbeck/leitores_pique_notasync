const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname);
const authDirectory = path.join(process.env.LOCALAPPDATA || process.env.APPDATA || os.homedir(), 'LeitoresPiqueNotaSync');
const usersFile = path.join(authDirectory, 'users.json');
const AUTH_IDLE_TIMEOUT_MS = 20 * 60 * 1000;
const AUTH_SESSION_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_AUTH_BODY_BYTES = 1024 * 1024;
const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml; charset=utf-8'
};

const users = loadUsers();
const sessions = new Map();

const server = http.createServer((request, response) => {
  let requestUrl;
  try {
    requestUrl = new URL(request.url, 'http://localhost');
    requestUrl.pathname = decodeURIComponent(requestUrl.pathname);
  } catch {
    response.writeHead(400).end('Bad request');
    return;
  }

  if (requestUrl.pathname === '/api/auth' || requestUrl.pathname.startsWith('/api/auth/')) {
    void handleAuthRequest(request, response, requestUrl);
    return;
  }

  const requestedPath = requestUrl.pathname === '/' ? '/index.html' : requestUrl.pathname;
  const filePath = path.resolve(root, `.${requestedPath}`);
  const relativePath = path.relative(root, filePath);
  if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    response.writeHead(403).end('Forbidden');
    return;
  }

  fs.stat(filePath, (statError, stats) => {
    if (statError || !stats.isFile()) {
      response.writeHead(404).end('Not found');
      return;
    }

    response.writeHead(200, {
      'Cache-Control': 'no-store',
      'Content-Length': stats.size,
      'Content-Type': mimeTypes[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
      'X-Content-Type-Options': 'nosniff'
    });
    fs.createReadStream(filePath).pipe(response);
  });
});

async function handleAuthRequest(request, response, requestUrl) {
  const authPath = requestUrl.pathname.slice('/api'.length);
  try {
    if (authPath === '/auth/login' && request.method === 'POST') {
      const body = await readJsonBody(request);
      login(response, body);
      return;
    }

    if (authPath === '/auth/refresh' && request.method === 'POST') {
      const body = await readJsonBody(request);
      refresh(response, body);
      return;
    }

    const current = authenticate(request);
    if (authPath === '/auth/me' && request.method === 'GET') {
      sendJson(response, 200, { user: authenticatedUser(current.user, current.session) });
      return;
    }

    if (authPath === '/auth/logout' && request.method === 'POST') {
      sessions.delete(current.session.id);
      response.writeHead(204, { 'Cache-Control': 'no-store' }).end();
      return;
    }

    if (authPath === '/auth/usuarios' && request.method === 'GET') {
      requireAdmin(response, current.user);
      sendJson(response, 200, users.map(publicUser));
      return;
    }

    if (authPath === '/auth/usuarios' && request.method === 'POST') {
      requireAdmin(response, current.user);
      const body = await readJsonBody(request);
      createUser(response, body);
      return;
    }

    const userRoute = authPath.match(/^\/auth\/usuarios\/([^/]+)(?:\/(reset-password))?$/);
    if (userRoute && userRoute[2] === 'reset-password' && request.method === 'POST') {
      requireAdmin(response, current.user);
      const body = await readJsonBody(request);
      resetUserPassword(response, decodeURIComponent(userRoute[1]), body);
      return;
    }

    if (userRoute && !userRoute[2] && request.method === 'PATCH') {
      requireAdmin(response, current.user);
      const body = await readJsonBody(request);
      updateUser(response, current.user, decodeURIComponent(userRoute[1]), body);
      return;
    }

    if (userRoute && !userRoute[2] && request.method === 'DELETE') {
      requireAdmin(response, current.user);
      deleteUser(response, current.user, decodeURIComponent(userRoute[1]));
      return;
    }

    if (authPath.startsWith('/auth/')) {
      response.setHeader('Allow', allowedMethods(authPath));
      sendJson(response, 405, { message: 'Método não permitido.' });
      return;
    }

    sendJson(response, 404, { message: 'Rota de autenticação não encontrada.' });
  } catch (error) {
    if (response.headersSent) return;
    const status = Number(error?.statusCode) || 500;
    sendJson(response, status, { message: error?.message || 'Erro interno de autenticação.' });
  }
}

function login(response, body) {
  const username = normalizeUsername(body.username);
  const password = typeof body.password === 'string' ? body.password : '';
  const user = users.find((entry) => entry.username === username);
  if (!user || !user.ativo || !verifyPassword(password, user.passwordSalt, user.passwordHash)) {
    sendJson(response, 401, { message: 'Usuário ou senha inválidos.' });
    return;
  }

  const now = Date.now();
  user.ultimoLoginAt = new Date(now).toISOString();
  user.updatedAt = user.ultimoLoginAt;
  saveUsers();
  const session = createSession(user, now);
  sendJson(response, 200, authResponse(user, session));
}

function refresh(response, body) {
  const refreshToken = typeof body.refreshToken === 'string' ? body.refreshToken : '';
  const now = Date.now();
  const session = findSessionByRefreshToken(refreshToken);
  const user = session && users.find((entry) => entry.id === session.userId);
  if (!session || !user || !user.ativo || isSessionExpired(session, now)) {
    if (session) sessions.delete(session.id);
    sendJson(response, 401, { message: 'Sessão expirada. Entre novamente.' });
    return;
  }

  session.accessToken = createToken();
  session.refreshToken = createToken();
  session.lastSeenAt = now;
  sendJson(response, 200, authResponse(user, session));
}

function authenticate(request) {
  const header = String(request.headers.authorization || '');
  const match = header.match(/^Bearer\s+(.+)$/i);
  const token = match?.[1]?.trim();
  const session = token ? findSessionByAccessToken(token) : null;
  const now = Date.now();
  const user = session && users.find((entry) => entry.id === session.userId);
  if (!session || !user || !user.ativo || isSessionExpired(session, now)) {
    if (session) sessions.delete(session.id);
    throw authError(401, 'Sessão inválida ou expirada. Entre novamente.');
  }

  if (request.headers['x-session-activity'] !== 'passive') session.lastSeenAt = now;
  return { user, session };
}

function requireAdmin(response, user) {
  if (user.role !== 'admin') {
    sendJson(response, 403, { message: 'Somente administradores podem acessar esta função.' });
    throw authError(403, 'Somente administradores podem acessar esta função.');
  }
}

function createUser(response, body) {
  const username = normalizeUsername(body.username);
  const password = typeof body.password === 'string' ? body.password : '';
  const role = body.role === 'admin' ? 'admin' : body.role === 'comum' ? 'comum' : '';
  if (!/^[a-z0-9._-]{3,80}$/i.test(username)) {
    sendJson(response, 400, { message: 'Usuário deve conter de 3 a 80 caracteres: letras, números, ponto, hífen ou sublinhado.' });
    return;
  }
  if (!password) {
    sendJson(response, 400, { message: 'Informe uma senha inicial.' });
    return;
  }
  if (!role) {
    sendJson(response, 400, { message: 'Selecione um perfil válido.' });
    return;
  }
  if (users.some((entry) => entry.username === username)) {
    sendJson(response, 409, { message: 'Este usuário já existe.' });
    return;
  }

  const now = new Date().toISOString();
  const passwordSalt = crypto.randomBytes(16).toString('hex');
  const user = {
    id: crypto.randomUUID(),
    username,
    nome: String(body.nome || '').trim(),
    role,
    ativo: body.ativo !== false,
    passwordSalt,
    passwordHash: hashPassword(password, passwordSalt),
    ultimoLoginAt: null,
    createdAt: now,
    updatedAt: now
  };
  users.push(user);
  saveUsers();
  sendJson(response, 201, publicUser(user));
}

function updateUser(response, actor, userId, body) {
  const user = users.find((entry) => entry.id === userId);
  if (!user) {
    sendJson(response, 404, { message: 'Usuário não encontrado.' });
    return;
  }
  if (body.ativo === false && user.id === actor.id) {
    sendJson(response, 400, { message: 'Não é possível desativar a própria conta.' });
    return;
  }
  const previousRole = user.role;
  const nextRole = body.role === undefined ? user.role : body.role;
  const nextAtivo = body.ativo === undefined ? user.ativo : Boolean(body.ativo);
  let nextUsername;
  if (!['admin', 'comum'].includes(nextRole)) {
    sendJson(response, 400, { message: 'Selecione um perfil válido.' });
    return;
  }
  if (body.username !== undefined) {
    const username = normalizeUsername(body.username);
    if (!/^[a-z0-9._-]{3,80}$/i.test(username)) {
      sendJson(response, 400, { message: 'Usuário deve conter de 3 a 80 caracteres: letras, números, ponto, hífen ou sublinhado.' });
      return;
    }
    if (users.some((entry) => entry.id !== user.id && entry.username === username)) {
      sendJson(response, 409, { message: 'Este usuário já existe.' });
      return;
    }
    nextUsername = username;
  }
  if (isActiveAdmin(user) && !(nextAtivo && nextRole === 'admin') && !hasOtherActiveAdmin(user.id)) {
    sendJson(response, 400, { message: 'Mantenha pelo menos um administrador ativo no sistema.' });
    return;
  }
  if (nextUsername !== undefined) user.username = nextUsername;
  if (body.ativo !== undefined) user.ativo = nextAtivo;
  if (body.nome !== undefined) user.nome = String(body.nome || '').trim();
  if (body.role !== undefined) {
    if (!['admin', 'comum'].includes(body.role)) {
      sendJson(response, 400, { message: 'Selecione um perfil válido.' });
      return;
    }
    user.role = body.role;
  }
  user.updatedAt = new Date().toISOString();
  if (!user.ativo || user.role !== previousRole) revokeUserSessions(user.id);
  saveUsers();
  sendJson(response, 200, publicUser(user));
}

function deleteUser(response, actor, userId) {
  const index = users.findIndex((entry) => entry.id === userId);
  if (index < 0) {
    sendJson(response, 404, { message: 'Usuário não encontrado.' });
    return;
  }
  const user = users[index];
  if (isActiveAdmin(user) && !hasOtherActiveAdmin(user.id)) {
    sendJson(response, 400, { message: 'Não é possível excluir o último administrador ativo.' });
    return;
  }
  users.splice(index, 1);
  revokeUserSessions(user.id);
  saveUsers();
  sendJson(response, 200, { id: user.id, deleted: true, deletedBy: actor.id });
}

function isActiveAdmin(user) {
  return user?.ativo === true && user?.role === 'admin';
}

function hasOtherActiveAdmin(excludedUserId) {
  return users.some((entry) => entry.id !== excludedUserId && isActiveAdmin(entry));
}

function resetUserPassword(response, userId, body) {
  const user = users.find((entry) => entry.id === userId);
  const password = typeof body.password === 'string' ? body.password : '';
  if (!user) {
    sendJson(response, 404, { message: 'Usuário não encontrado.' });
    return;
  }
  if (!password) {
    sendJson(response, 400, { message: 'Informe uma nova senha.' });
    return;
  }
  user.passwordSalt = crypto.randomBytes(16).toString('hex');
  user.passwordHash = hashPassword(password, user.passwordSalt);
  user.updatedAt = new Date().toISOString();
  revokeUserSessions(user.id);
  saveUsers();
  sendJson(response, 200, publicUser(user));
}

function createSession(user, now) {
  const session = {
    id: crypto.randomUUID(),
    userId: user.id,
    accessToken: createToken(),
    refreshToken: createToken(),
    createdAt: now,
    lastSeenAt: now,
    expiresAt: now + AUTH_SESSION_LIFETIME_MS
  };
  sessions.set(session.id, session);
  return session;
}

function authResponse(user, session) {
  return {
    accessToken: session.accessToken,
    refreshToken: session.refreshToken,
    tokenType: 'Bearer',
    expiresIn: Math.max(0, Math.floor((session.expiresAt - Date.now()) / 1000)),
    refreshExpiresIn: Math.max(0, Math.floor((session.expiresAt - Date.now()) / 1000)),
    sessionExpiresAt: new Date(session.expiresAt).toISOString(),
    user: authenticatedUser(user, session)
  };
}

function authenticatedUser(user, session) {
  return {
    userId: user.id,
    username: user.username,
    nome: user.nome || undefined,
    role: user.role,
    sessionId: session.id,
    sessionExpiresAt: new Date(session.expiresAt).toISOString()
  };
}

function publicUser(user) {
  return {
    id: user.id,
    username: user.username,
    nome: user.nome || undefined,
    role: user.role,
    ativo: user.ativo,
    ultimoLoginAt: user.ultimoLoginAt,
    passwordChangedAt: user.passwordChangedAt || user.createdAt,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt
  };
}

function loadUsers() {
  fs.mkdirSync(authDirectory, { recursive: true });
  if (fs.existsSync(usersFile)) {
    const parsed = JSON.parse(fs.readFileSync(usersFile, 'utf8'));
    if (!Array.isArray(parsed.users)) throw new Error(`Arquivo de usuários inválido: ${usersFile}`);
    return parsed.users;
  }

  const username = normalizeUsername(process.env.ADMIN_USERNAME || 'admin');
  if (!/^[a-z0-9._-]{3,80}$/i.test(username)) throw new Error('ADMIN_USERNAME inválido.');
  const generatedPassword = !process.env.ADMIN_PASSWORD;
  const initialPassword = generatedPassword ? crypto.randomBytes(24).toString('base64url') : process.env.ADMIN_PASSWORD;
  const now = new Date().toISOString();
  const passwordSalt = crypto.randomBytes(16).toString('hex');
  const admin = {
    id: crypto.randomUUID(),
    username,
    nome: 'Administrador',
    role: 'admin',
    ativo: true,
    passwordSalt,
    passwordHash: hashPassword(initialPassword, passwordSalt),
    ultimoLoginAt: null,
    createdAt: now,
    updatedAt: now
  };
  const seededUsers = [admin];
  fs.writeFileSync(usersFile, JSON.stringify({ users: seededUsers }, null, 2), { mode: 0o600 });
  if (generatedPassword) {
    process.stdout.write(`\nUsuário administrador criado: ${username}\nSenha inicial (anote agora): ${initialPassword}\nArquivo local: ${usersFile}\n\n`);
  } else {
    process.stdout.write(`Usuário administrador criado: ${username}\nArquivo local: ${usersFile}\n`);
  }
  return seededUsers;
}

function saveUsers() {
  const temporaryFile = `${usersFile}.${process.pid}.tmp`;
  fs.writeFileSync(temporaryFile, JSON.stringify({ users }, null, 2), { mode: 0o600 });
  fs.renameSync(temporaryFile, usersFile);
}

function hashPassword(password, salt) {
  return crypto.scryptSync(String(password), salt, 64).toString('hex');
}

function verifyPassword(password, salt, expectedHash) {
  if (typeof password !== 'string' || !salt || !expectedHash) return false;
  const expected = Buffer.from(expectedHash, 'hex');
  const received = Buffer.from(hashPassword(password, salt), 'hex');
  return expected.length === received.length && crypto.timingSafeEqual(expected, received);
}

function normalizeUsername(value) {
  return String(value || '').trim().toLowerCase();
}

function createToken() {
  return crypto.randomBytes(32).toString('base64url');
}

function findSessionByAccessToken(token) {
  return [...sessions.values()].find((session) => session.accessToken === token);
}

function findSessionByRefreshToken(token) {
  return [...sessions.values()].find((session) => session.refreshToken === token);
}

function isSessionExpired(session, now) {
  return session.expiresAt <= now || session.lastSeenAt + AUTH_IDLE_TIMEOUT_MS <= now;
}

function revokeUserSessions(userId) {
  for (const [sessionId, session] of sessions) {
    if (session.userId === userId) sessions.delete(sessionId);
  }
}

function allowedMethods(authPath) {
  if (authPath === '/auth/login' || authPath === '/auth/refresh') return 'POST';
  if (authPath === '/auth/me' || authPath === '/auth/usuarios') return authPath === '/auth/usuarios' ? 'GET, POST' : 'GET';
  if (authPath === '/auth/logout') return 'POST';
  if (/^\/auth\/usuarios\/[^/]+\/reset-password$/.test(authPath)) return 'POST';
  if (/^\/auth\/usuarios\/[^/]+$/.test(authPath)) return 'PATCH, DELETE';
  return 'GET, POST, PATCH';
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let tooLarge = false;
    request.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_AUTH_BODY_BYTES) {
        tooLarge = true;
        chunks.length = 0;
        return;
      }
      if (!tooLarge) chunks.push(chunk);
    });
    request.on('end', () => {
      if (tooLarge) {
        reject(authError(413, 'A solicitação excede o limite permitido.'));
        return;
      }
      if (!chunks.length) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(authError(400, 'Corpo JSON inválido.'));
      }
    });
    request.on('error', reject);
  });
}

function sendJson(response, status, value) {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body),
    'Content-Type': 'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff'
  });
  response.end(body);
}

function authError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

const port = Number(process.env.PORT) || 4173;
const host = process.env.HOST || '127.0.0.1';
server.listen(port, host, () => {
  process.stdout.write(`Leitor XML disponível em http://${host}:${port}\n`);
});
