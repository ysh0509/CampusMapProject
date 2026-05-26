import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';

// HTML에서 주입한 window.__ENV를 읽어온다.
function getEnv(key, fallback = '') {
  if (typeof window !== 'undefined' && window.__ENV && window.__ENV[key]) {
    return window.__ENV[key];
  }
  return fallback;
}

const SUPABASE_URL = getEnv('SUPABASE_URL');
const SUPABASE_ANON_KEY = getEnv('SUPABASE_ANON_KEY');    

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  throw new Error('Supabase 환경변수(SUPABASE_URL, SUPABASE_ANON_KEY)가 설정되지 않았습니다.');
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ============================
// AUTH
// ============================
export async function login(email, password) {
  return await supabase.auth.signInWithPassword({ email, password });
}
export async function logout() {
  return await supabase.auth.signOut();
}
export async function getUser() {
  return await supabase.auth.getUser();
}

// ============================
// CRUD
// ============================
export async function fetchTable(table) {
  return await supabase.from(table).select('*');
}
export async function insertRow(table, data) {
  return await supabase.from(table).insert(data);
}
export async function updateRow(table, id, data) {
  return await supabase.from(table).update(data).eq('id', id);
}
export async function deleteRow(table, id) {
  return await supabase.from(table).delete().eq('id', id);
}
