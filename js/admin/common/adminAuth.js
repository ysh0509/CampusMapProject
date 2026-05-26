import { supabase } from './adminApi.js';

export async function requireAuth() {

  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    location.href = '../admin/admin_login.html';
    return null;
  }

  return user;
}
