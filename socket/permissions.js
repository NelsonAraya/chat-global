// Quién puede ver o administrar qué: administrador general, admin de departamento y usuarios.

// ===== Administradores =====
// Un admin SIN departamentos asignados es el administrador general: ve y administra todo.
// Los demás admins lo son solo en los departamentos marcados como tales (adminDepartments); en el resto de
// sus departamentos son usuarios normales. Solo ven y administran lo de sus departamentos de admin
// (usuarios, salas, alertas y estadísticas). Las solicitudes de registro, los departamentos y el registro
// de errores quedan solo para el administrador general.
const isSuperAdmin = (u) => !!u && u.role === 'admin' && !(u.departments || []).length;
const adminDeptsOf = (u) => (u && u.role === 'admin' ? (u.adminDepartments || []) : []);
const isDeptAdmin = (u) => !isSuperAdmin(u) && adminDeptsOf(u).length > 0;

// Departamentos "en los que está" un usuario conectado: aquellos donde es admin (todos a la vez) más el
// que eligió al entrar, donde puede ser un usuario normal.
const deptsOf = (u) => {
  const list = [...adminDeptsOf(u)];
  if (u.department && !list.includes(u.department)) list.push(u.department);
  return list;
};

// Departamentos que administra un admin (null = todos).
const adminScope = (admin) => (isSuperAdmin(admin) ? null : adminDeptsOf(admin));
const inAdminScope = (admin, department) => isSuperAdmin(admin) || (!!department && adminScope(admin).includes(department));

// ¿Puede este admin administrar esta cuenta? El general, a todos. El de departamento, a quienes comparten
// alguno de sus departamentos de admin, siempre que la cuenta no sea admin fuera de ellos; nunca a un
// administrador general.
const canManageUser = (admin, target) => {
  if (isSuperAdmin(admin)) return true;
  if (!isDeptAdmin(admin) || isSuperAdmin(target)) return false;
  const scope = adminScope(admin);
  if (adminDeptsOf(target).some(d => !scope.includes(d))) return false;
  return (target.departments || []).some(d => scope.includes(d));
};

// Cambiar la contraseña o el correo, bloquear o eliminar una cuenta afecta también a sus otros
// departamentos: el admin de departamento solo puede hacerlo si todos los departamentos de la cuenta son suyos.
const FULL_SCOPE_ERROR = 'Ese usuario también pertenece a otros departamentos: solo el administrador general puede hacerlo';
const canManageUserFully = (admin, target) => canManageUser(admin, target) &&
  (isSuperAdmin(admin) || (target.departments || []).every(d => adminScope(admin).includes(d)));

// Quién ve a quién en "Conectados": el general ve a todos y todos lo ven a él; el resto, solo a quienes
// comparten departamento.
const canViewUser = (target, viewer) => {
  if (isSuperAdmin(viewer) || isSuperAdmin(target)) return true;
  const viewerDepts = deptsOf(viewer);
  return deptsOf(target).some(d => viewerDepts.includes(d));
};

// Una sala sin departamento es global (visible por todos). Si tiene departamento, solo la ven quienes
// están en ese departamento (y el administrador general).
const canViewRoom = (room, viewer) => {
  if (isSuperAdmin(viewer)) return true;
  return !room.department || deptsOf(viewer).includes(room.department);
};

module.exports = { isSuperAdmin, adminDeptsOf, deptsOf, adminScope, inAdminScope, canManageUser, FULL_SCOPE_ERROR,
  canManageUserFully, canViewUser, canViewRoom };
