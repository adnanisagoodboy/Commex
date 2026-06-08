/**
 * Commex Role Permission System
 * 
 * Roles (per org):
 *   owner      — full control, cannot be removed
 *   admin      — almost full control, set by owner
 *   moderator  — content moderation only
 *   member     — can comment, react, reply
 *   banned     — blocked from this org
 *
 * Global roles (Commex platform):
 *   superadmin — can access everything
 *   user       — normal user
 */

const PERMISSIONS = {
  // What each role CAN do in an org
  owner: [
    'comment', 'react', 'reply',
    'pin_comment', 'delete_any_comment', 'edit_any_comment',
    'approve_comments', 'reject_comments',
    'ban_user', 'unban_user',
    'manage_members', 'assign_roles',
    'edit_org_settings', 'delete_org',
    'view_flagged', 'view_pending', 'view_analytics',
    'manage_word_filter', 'manage_domains',
  ],
  admin: [
    'comment', 'react', 'reply',
    'pin_comment', 'delete_any_comment', 'edit_any_comment',
    'approve_comments', 'reject_comments',
    'ban_user', 'unban_user',
    'manage_members',
    'edit_org_settings',
    'view_flagged', 'view_pending', 'view_analytics',
    'manage_word_filter', 'manage_domains',
  ],
  moderator: [
    'comment', 'react', 'reply',
    'pin_comment', 'delete_any_comment',
    'approve_comments', 'reject_comments',
    'view_flagged', 'view_pending',
  ],
  member: [
    'comment', 'react', 'reply',
  ],
  banned: [],
};

/**
 * Get the role of a user within an org
 * Returns: 'owner' | 'admin' | 'moderator' | 'member' | 'banned' | null
 */
function getOrgRole(org, userId) {
  const uid = userId.toString();

  // Check banned first
  if ((org.bannedUsers || []).find(b => b.userId === uid)) return 'banned';

  // Check owner
  if (org.owner.toString() === uid) return 'owner';

  // Check members list
  const member = (org.members || []).find(m => m.user.toString() === uid);
  if (member) return member.role; // 'admin' | 'moderator' | 'member'

  return null; // not a member, but can still comment if org is open
}

/**
 * Check if a user has a specific permission in an org
 */
function hasPermission(org, userId, permission, isGlobalSuperAdmin = false) {
  if (isGlobalSuperAdmin) return true;
  const role = getOrgRole(org, userId);
  if (!role) {
    // Non-member — only basic permissions
    return ['comment', 'react', 'reply'].includes(permission);
  }
  return (PERMISSIONS[role] || []).includes(permission);
}

/**
 * Middleware factory — require a permission to access a route
 */
function requirePermission(permission) {
  return (req, res, next) => {
    const isSuperAdmin = req.user?.role === 'superadmin';
    if (!hasPermission(req.org, req.user._id, permission, isSuperAdmin)) {
      const role = getOrgRole(req.org, req.user._id.toString());
      return res.status(403).json({
        error: `Permission denied: requires '${permission}'`,
        yourRole: role || 'visitor',
        requiredPermission: permission,
      });
    }
    next();
  };
}

module.exports = { PERMISSIONS, getOrgRole, hasPermission, requirePermission };
