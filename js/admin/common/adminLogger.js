// /js/admin/common/adminLogger.js

import { supabase } from './adminApi.js';

/**
 * 관리자 액션 로그 기록
 * 
 * @param {Object} params
 * @param {string} params.action - 수행된 액션 (create, update, delete, batch_update 등)
 * @param {string} params.target_type - 대상 타입 (building, floor, indoor_node, outdoor_edge 등)
 * @param {number|string|null} params.target_id - 대상의 ID
 * @param {string} [params.description] - 상세 설명
 * @param {Object|null} [params.before] - 변경 전 데이터 객체
 * @param {Object|null} [params.after] - 변경 후 데이터 객체
 */

export async function logAction({
  action,
  target_type,
  target_id = null,
  description = '',
  before = null,
  after = null
}) {

  try {

    // 1. 필수값 검증
    if (!action || !target_type) {
      console.error('[adminLogger] action 또는 target_type 누락');
      return false;
    }

    // 2. 현재 로그인 사용자 조회
    const {
      data: { user },
      error: userError
    } = await supabase.auth.getUser();

    if (userError) {
      console.error('[adminLogger] 사용자 조회 실패', userError);
      return false;
    }

    if (!user) {
      console.warn('[adminLogger] 로그인 사용자 없음');
      return false;
    }

    // 3. [시간 보정 로직] 한국 시간(KST) 생성
    // DB의 UTC 기준 시간 문제를 해결하기 위해 클라이언트에서 KST를 계산하여 주입합니다.
    const now = new Date();
    const kstOffset = 9 * 60 * 60 * 1000; // UTC+9 시간 (밀리초)
    const kstDate = new Date(now.getTime() + kstOffset);
    
    // ISO 8601 형식으로 변환하되, 타임존 혼선을 방지하기 위해 
    // Z(UTC 표시)를 제거하고 생성된 시간을 문자열로 만듭니다.
    const kstISOString = kstDate.toISOString().replace(/\.\d{3}Z$/, '');

    // 4. 로그 저장
    const { error } = await supabase
      .from('admin_logs')
      .insert({
        admin_id: user.id,
        action,
        target_type,
        target_id,
        description,
        before_data: before,
        after_data: after,
        created_at: kstISOString // ✅ 보정된 한국 시간을 직접 주입
      });

    if (error) {
      console.error('[adminLogger] 로그 저장 실패', error);
      return false;
    }

    return true;

  } catch (err) {

    console.error('[adminLogger] 예외 발생', err);
    return false;

  }

}
