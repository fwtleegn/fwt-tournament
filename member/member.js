'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const config = window.FWT_MEMBER_CONFIG;
  let mode = 'signup', pendingEmail = '', user = null, client;
  const now = new Date();
  const maxMonth = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
  $('tennis-since').max = $('edit-since').max = maxMonth;
  $('edit-age').replaceChildren(...Array.from($('age-band').options).map(o => o.cloneNode(true)));
  $('edit-age').required = true;
  function notice(message, error = false) { $('notice').textContent = message; $('notice').className = error ? 'error' : ''; }
  function profileValues(edit = false) {
    const nickname = $(edit ? 'edit-nickname' : 'nickname').value.trim();
    const age_band = $(edit ? 'edit-age' : 'age-band').value;
    const month = $(edit ? 'edit-since' : 'tennis-since').value;
    if (nickname.length < 2 || nickname.length > 24) throw new Error('별명은 2~24자로 입력해주세요.');
    if (!['under20','20s','30s','40s','50s','60plus','private'].includes(age_band)) throw new Error('연령대를 선택해주세요.');
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || month > maxMonth || month < '1900-01') throw new Error('테니스 시작 연월을 확인해주세요.');
    return { nickname, age_band, tennis_since: `${month}-01`, directory_consent: true };
  }
  function friendly(error) {
    const code = error?.code;
    if (code === 'over_email_send_rate_limit' || error?.status === 429) return '요청이 많습니다. 잠시 후 다시 시도해주세요.';
    if (code === 'otp_expired') return '인증번호가 만료되었거나 올바르지 않습니다. 다시 확인하거나 새 이메일을 받아주세요.';
    if (code === 'user_not_found' || code === 'signup_disabled') return '로그인할 수 없습니다. 가입 여부를 확인하거나 운영자에게 문의해주세요.';
    if (code === '23505') return '이미 사용 중인 별명입니다. 다른 별명을 선택해주세요.';
    if (code === '42501') return '접근 권한을 확인할 수 없습니다. 다시 로그인하거나 운영자에게 문의해주세요.';
    return error instanceof TypeError ? '연결이 원활하지 않습니다. 인터넷 연결을 확인한 뒤 다시 시도해주세요.' : '처리하지 못했습니다. 입력 내용을 확인하거나 잠시 후 다시 시도해주세요.';
  }
  async function run(form, work) {
    const buttons = [...form.querySelectorAll('button')];
    if (form.dataset.busy) return;
    form.dataset.busy = 'true'; buttons.forEach(b => b.disabled = true);
    try { await work(); } catch (error) { notice(friendly(error), true); }
    finally { delete form.dataset.busy; buttons.forEach(b => b.disabled = false); }
  }
  function setMode(next, internal = false) {
    if (!internal && ($('request-form').dataset.busy || $('verify-form').dataset.busy)) return;
    mode = next;
    $('signup-fields').hidden = next !== 'signup';
    $('signup-fields').querySelectorAll('input,select').forEach(e => e.disabled = next !== 'signup');
    $('signup-tab').setAttribute('aria-pressed', String(next === 'signup'));
    $('login-tab').setAttribute('aria-pressed', String(next === 'login'));
    $('page-title').textContent = next === 'signup' ? 'FWT와 함께 시작하세요' : '다시 만나 반갑습니다';
    $('description').textContent = '이메일로 본인 확인 후 이용할 수 있습니다.';
    $('request-form').hidden = false; $('verify-form').hidden = true;
    if (config.enabled) notice('');
  }
  async function showProfile() {
    const { data: authData, error: authError } = await client.auth.getUser();
    if (authError || !authData.user?.email_confirmed_at) throw authError || new Error('Email verification required');
    user = authData.user;
    let { data, error } = await client.from('member_profiles').select('nickname,age_band,tennis_since').eq('id', user.id).maybeSingle();
    if (error) throw error;
    if (!data) {
      const initial = user.user_metadata?.fwt_profile;
      if (initial) {
        $('nickname').value = initial.nickname || '';
        $('age-band').value = initial.age_band || '';
        $('tennis-since').value = initial.tennis_since?.slice(0,7) || '';
      }
      $('email').value = user.email || ''; $('email').readOnly = true;
      $('send-button').textContent = '프로필 완성하기';
      setMode('signup', true); $('login-tab').disabled = true; notice('이메일 인증이 완료되었습니다. 프로필 내용을 확인하고 저장해주세요.'); return;
    }
    $('request-form').hidden = $('verify-form').hidden = true;
    $('profile').hidden = false; document.querySelector('.tabs').hidden = true;
    $('page-title').textContent = '나의 FWT 프로필'; $('description').textContent = '회원 정보는 언제든 수정할 수 있습니다.';
    $('profile-name').textContent = data.nickname;
    $('edit-nickname').value = data.nickname; $('edit-age').value = data.age_band; $('edit-since').value = data.tennis_since.slice(0,7);
    notice('');
    window.FWT_MEMBER_RUNTIME = {client,user};
    window.dispatchEvent(new CustomEvent('fwt-member-ready',{detail:window.FWT_MEMBER_RUNTIME}));
  }
  $('signup-tab').onclick = () => setMode('signup');
  $('login-tab').onclick = () => setMode('login');
  $('back-button').onclick = () => { $('request-form').hidden = false; $('verify-form').hidden = true; $('token').value = ''; notice(''); };
  $('request-form').onsubmit = event => {
    event.preventDefault(); if (!config.enabled || !client) return;
    run(event.currentTarget, async () => {
      let profile;
      if (mode === 'signup') { try { profile = profileValues(); } catch (error) { notice(error.message,true); return; } }
      if (user) {
        const { error } = await client.from('member_profiles').insert({ id:user.id, ...profile });
        if (error) throw error; await showProfile(); return;
      }
      pendingEmail = $('email').value.trim();
      const { error } = await client.auth.signInWithOtp({email: pendingEmail, options: {
        shouldCreateUser: mode === 'signup',
        emailRedirectTo: new URL('./index.html', location.href).href,
        ...(profile ? {data: {fwt_profile: profile}} : {})
      }});
      if (error) throw error;
      $('request-form').hidden = true; $('verify-form').hidden = false;
      notice('인증 이메일을 요청했습니다. 이메일의 인증 링크 또는 인증번호로 본인 확인을 진행해주세요. 스팸함도 확인해주세요.'); $('token').focus();
    });
  };
  $('verify-form').onsubmit = event => {
    event.preventDefault(); run(event.currentTarget, async () => {
      const {error} = await client.auth.verifyOtp({email:pendingEmail, token:$('token').value.trim(), type:'email'});
      if (error) throw error; $('token').value = ''; await showProfile();
    });
  };
  $('profile-form').onsubmit = event => {
    event.preventDefault(); run(event.currentTarget, async () => {
      let values; try { values = profileValues(true); } catch(error) {notice(error.message,true);return;}
      const {data, error} = await client.from('member_profiles').update(values).eq('id',user.id).select('id').single();
      if (error || !data) throw error || new Error('No profile updated');
      $('profile-name').textContent = values.nickname; notice('프로필을 저장했습니다.');
    });
  };
  $('logout').onclick = async () => {
    $('logout').disabled = true;
    try { const {error} = await client.auth.signOut(); if(error) throw error; location.replace('./index.html'); }
    catch(error) {notice(friendly(error),true);$('logout').disabled=false;}
  };
  async function start() {
    if (!config?.enabled) { $('fields').disabled = true; notice('회원가입을 준비하고 있습니다. 대회는 가입 없이 둘러볼 수 있습니다.'); return; }
    if (!window.supabase) { $('fields').disabled = true; notice('로그인 서비스를 불러오지 못했습니다. 인터넷 연결을 확인하고 새로고침해주세요.',true); return; }
    // Isolates browser session state from legacy admin screens; DB policies enforce authorization.
    client = window.supabase.createClient(config.url, config.key, {auth:{storageKey:'fwt-member-session-v1'}});
    try { const {data,error} = await client.auth.getSession(); if(error) throw error; if(data.session) await showProfile(); }
    catch(error) { notice(friendly(error),true); }
    client.auth.onAuthStateChange((event) => { if(event === 'SIGNED_OUT') location.replace('./index.html'); });
  }
  start();
})();

