import { supabase } from './adminApi.js';

const LOGIN_PATH = '/html/admin/admin_login.html';

/**
 * 페이지 접근 권한을 보호하는 함수
 * 세션 존재 여부, 관리자 권한 여부, 계정 활성화 여부를 모두 체크합니다.
 */
export async function protectPage() {
  try {
    // 1. 세션 정보 가져오기
    const { data: sessionData, error: sessionErr } = await supabase.auth.getSession();
    if (sessionErr) throw sessionErr;

    const user = sessionData?.session?.user;
    if (!user) {
      location.href = LOGIN_PATH;
      return null;
    }

    // 2. DB에서 해당 사용자의 상세 프로필(role, is_active) 조회
    const { data: roleData, error: roleErr } = await supabase
      .from('admin_users')
      .select('role, is_active')
      .eq('id', user.id)
      .single();

    if (roleErr || !roleData) {
      throw new Error('Profile not found');
    }

    // 3. 계정 활성화 상태 체크 (강제 로그아웃 핵심)
    if (!roleData.is_active) {
      alert('비활성화된 계정입니다. 관리자에게 문의하세요.');
      await supabase.auth.signOut(); // 클라이언트 세션 파괴
      location.href = LOGIN_PATH;
      return null;
    }

    // 4. 권한 체크
    const role = roleData.role;
    const allowed = role === 'admin' || role === 'superadmin';

    if (!allowed) {
      alert('접근 권한이 없습니다.');
      location.href = LOGIN_PATH;
      return null;
    }

    return user;
  } catch (e) {
    console.error('protectPage error', e);
    location.href = LOGIN_PATH;
    return null;
  }
}
