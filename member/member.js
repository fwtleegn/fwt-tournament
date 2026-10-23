'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const config = window.FWT_MEMBER_CONFIG;
  let mode = 'signup', pendingEmail = '', user = null, client, recovery = new URLSearchParams(location.hash.slice(1)).get('type') === 'recovery';
  const redirectTo = new URL('./index.html', location.href).href;
  function passwordValue(id, confirmation) {
    const value = $(id).value;
    if (value.length < 8 || value.length > 128) throw new Error('비밀번호는 8~128자로 입력해주세요.');
    if (value !== $(confirmation).value) throw new Error('비밀번호 확인이 일치하지 않습니다.');
    return value;
  }
  function passwordScreen() {
    $('member-home').hidden = true; recovery = true; $('request-form').hidden = $('verify-form').hidden = $('profile').hidden = $('forgot-button').hidden = true;
    document.querySelector('.tabs').hidden = true; $('password-form').hidden = false;
    $('page-title').textContent = '비밀번호 설정'; $('description').textContent = '저장 후 이메일과 비밀번호로 로그인할 수 있습니다.';
  }
  const now = new Date();
  const maxMonth = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
  const maxDate = `${maxMonth}-${String(now.getDate()).padStart(2,'0')}`;
  $('tennis-since').max = $('edit-since').max = maxMonth;
  $('birth-date').max = $('edit-birth-date').max = maxDate;
  function notice(message, error = false) { $('notice').textContent = message; $('notice').className = error ? 'error' : ''; }
  function profileValues(edit = false) {
    const nickname = $(edit ? 'edit-nickname' : 'nickname').value.trim();
    const birth_date = $(edit ? 'edit-birth-date' : 'birth-date').value;
    const month = $(edit ? 'edit-since' : 'tennis-since').value;
    if (nickname.length < 2 || nickname.length > 24) throw new Error('별명은 2~24자로 입력해주세요.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(birth_date) || birth_date < '1900-01-01' || birth_date > maxDate) throw new Error('생년월일을 확인해주세요.');
    const parsedBirth = new Date(`${birth_date}T00:00:00Z`);
    if (Number.isNaN(parsedBirth.getTime()) || parsedBirth.toISOString().slice(0,10) !== birth_date) throw new Error('올바른 생년월일을 입력해주세요.');
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || month > maxMonth || month < '1900-01') throw new Error('테니스 시작 연월을 확인해주세요.');
    return { nickname, birth_date, tennis_since: `${month}-01`, directory_consent: true };
  }
  async function saveMemberProfile(values) {
    const { data, error } = await client.rpc('fwt_save_member_profile', {
      p_nickname: values.nickname,
      p_birth_date: values.birth_date,
      p_tennis_since: values.tennis_since,
      p_directory_consent: values.directory_consent
    });
    if (error) throw error;
    if (!data?.id) throw new Error('No profile saved');
    return data;
  }
  function friendly(error) {
    const code = error?.code;
    if (error instanceof Error && /비밀번호는|비밀번호 확인/.test(error.message)) return error.message;
    if (code === 'invalid_credentials') return '이메일 또는 비밀번호가 올바르지 않습니다. 기존 이메일 인증 가입자는 비밀번호 설정 / 찾기를 이용해주세요.';
    if (code === 'email_not_confirmed') return '가입 인증 이메일의 링크를 먼저 눌러주세요. 회원가입 화면에서 인증 이메일을 다시 받을 수 있습니다.';
    if (code === 'weak_password') return '더 안전한 비밀번호를 입력해주세요. 8자 이상이며 영문·숫자·기호 조합을 권장합니다.';
    if (code === 'same_password') return '현재와 다른 새 비밀번호를 입력해주세요.';
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
    const collectProfile = next === 'signup' && !!user;
    $('member-home').hidden = $('profile').hidden = $('password-form').hidden = true;
    document.querySelector('.tabs').hidden = false;
    $('password-fields').hidden = collectProfile || next === 'reset';
    $('password').disabled = collectProfile || next === 'reset';
    $('password-confirm').disabled = collectProfile || next !== 'signup';
    $('confirm-label').hidden = next !== 'signup';
    $('password').autocomplete = next === 'signup' ? 'new-password' : 'current-password';
    $('password').value = $('password-confirm').value = '';
    $('forgot-button').hidden = collectProfile || next === 'reset';
    $('send-button').textContent = collectProfile ? '프로필 완성하기' : next === 'signup' ? '가입 인증 이메일 받기' : next === 'reset' ? '비밀번호 설정 이메일 받기' : '로그인';
    $('signup-fields').hidden = !collectProfile;
    $('signup-fields').querySelectorAll('input,select').forEach(e => e.disabled = !collectProfile);
    $('signup-tab').setAttribute('aria-pressed', String(next === 'signup'));
    $('login-tab').setAttribute('aria-pressed', String(next === 'login'));
    $('page-title').textContent = next === 'signup' ? 'FWT와 함께 시작하세요' : '다시 만나 반갑습니다';
    $('description').textContent = collectProfile ? '회원 프로필을 완성해주세요.' : next === 'signup' ? '이메일과 비밀번호를 입력하고 가입 인증을 완료해주세요.' : next === 'reset' ? '가입한 이메일로 비밀번호 설정 링크를 보내드립니다.' : '이메일과 비밀번호로 로그인하세요.';
    if(next === 'reset') $('page-title').textContent = '비밀번호 설정 / 찾기';
    $('request-form').hidden = false; $('verify-form').hidden = true;
    if (config.enabled) notice('');
  }
  async function showProfile() {
    const { data: authData, error: authError } = await client.auth.getUser();
    if (authError || !authData.user?.email_confirmed_at) throw authError || new Error('Email verification required');
    user = authData.user;
    if (recovery) { passwordScreen(); return; }
    const { data, error } = await client.rpc('fwt_member_profile');
    if (error) throw error;
    if (!data?.birth_date) {
      const initial = data || user.user_metadata?.fwt_profile;
      if (initial) {
        $('nickname').value = initial.nickname || '';
        $('birth-date').value = initial.birth_date || '';
        $('tennis-since').value = initial.tennis_since?.slice(0,7) || '';
      }
      $('email').value = user.email || ''; $('email').readOnly = true;
      $('send-button').textContent = '프로필 완성하기';
      setMode('signup', true); $('login-tab').disabled = true; notice('이메일 인증이 완료되었습니다. 프로필 내용을 확인하고 저장해주세요.'); return;
    }
    $('request-form').hidden = $('verify-form').hidden = $('forgot-button').hidden = true;
    $('profile').hidden = $('member-home').hidden = false; document.querySelector('.tabs').hidden = true;
    document.querySelector('.card').classList.add('member-dashboard');
    document.querySelector('main').classList.add('signed-in');
    $('page-title').textContent = 'FWT에 오신 것을 환영합니다'; $('description').textContent = '대회를 둘러보고 나의 경기를 확인하세요.';
    $('profile-name').textContent = data.nickname;
    $('edit-nickname').value = data.nickname; $('edit-birth-date').value = data.birth_date; $('edit-since').value = data.tennis_since.slice(0,7);
    notice('');
    window.FWT_MEMBER_RUNTIME = {client,user};
    window.dispatchEvent(new CustomEvent('fwt-member-ready',{detail:window.FWT_MEMBER_RUNTIME}));
  }
  $('signup-tab').onclick = () => setMode('signup');
  $('login-tab').onclick = () => setMode('login');
  $('back-button').onclick = () => setMode('login');
  $('forgot-button').onclick = () => setMode('reset');
  $('set-password').onclick = () => { passwordScreen(); notice('새 비밀번호를 직접 입력하고 저장해주세요.'); };
  $('resend-button').onclick = () => run($('verify-form'), async () => {
    const {error} = await client.auth.resend({type:'signup',email:pendingEmail,options:{emailRedirectTo:redirectTo}});
    if(error) throw error; notice('인증 이메일을 다시 요청했습니다. 받은편지함과 스팸함을 확인해주세요.');
  });
  $('request-form').onsubmit = event => {
    event.preventDefault(); if (!config.enabled || !client) return;
    run(event.currentTarget, async () => {
      if (user) {
        let profile; try { profile = profileValues(); } catch(error) {notice(error.message,true);return;}
        await saveMemberProfile(profile); await showProfile(); return;
      }
      pendingEmail = $('email').value.trim();
      if (mode === 'reset') {
        const {error} = await client.auth.resetPasswordForEmail(pendingEmail,{redirectTo});
        if(error) throw error; notice('가입한 이메일이라면 비밀번호 설정 링크가 발송됩니다. 링크를 열어 새 비밀번호를 직접 저장해주세요.'); return;
      }
      if (mode === 'signup') {
        const password = passwordValue('password','password-confirm');
        const {data,error} = await client.auth.signUp({email:pendingEmail,password,options:{emailRedirectTo:redirectTo}});
        $('password').value = $('password-confirm').value = '';
        if(error) throw error;
        if(data?.session) { await showProfile(); return; }
        $('request-form').hidden = $('forgot-button').hidden = true; $('verify-form').hidden = false;
        notice('가입 인증 이메일을 요청했습니다. 링크를 눌러 인증해주세요. 이미 가입했다면 로그인 또는 비밀번호 설정 / 찾기를 이용해주세요.');
      } else {
        const password = $('password').value;
        const {error} = await client.auth.signInWithPassword({email:pendingEmail,password});
        $('password').value = '';
        if(error) throw error; await showProfile();
      }
    });
  };
  $('password-form').onsubmit = event => {
    event.preventDefault(); run(event.currentTarget, async () => {
      const password = passwordValue('new-password','new-password-confirm');
      const {error} = await client.auth.updateUser({password});
      $('new-password').value = $('new-password-confirm').value = '';
      if(error) throw error;
      recovery = false; history.replaceState(null,'',redirectTo);
      $('password-form').hidden = true; await showProfile();
      notice('비밀번호를 저장했습니다. 다음부터 이메일과 비밀번호로 로그인하세요.');
    });
  };
  $('profile-form').onsubmit = event => {
    event.preventDefault(); run(event.currentTarget, async () => {
      let values; try { values = profileValues(true); } catch(error) {notice(error.message,true);return;}
      await saveMemberProfile(values);
      $('profile-name').textContent = values.nickname; notice('프로필을 저장했습니다.');
    });
  };
  $('logout').onclick = async () => {
    $('logout').disabled = true;
    try { const {error} = await client.auth.signOut(); if(error) throw error; location.replace('./index.html'); }
    catch(error) {notice(friendly(error),true);$('logout').disabled=false;}
  };
  async function start() {
    setMode(new URLSearchParams(location.search).get('mode')==='login'?'login':'signup');
    if (!config?.enabled) { $('fields').disabled = true; notice('회원가입을 준비하고 있습니다. 대회는 가입 없이 둘러볼 수 있습니다.'); return; }
    if (!window.supabase) { $('fields').disabled = true; notice('로그인 서비스를 불러오지 못했습니다. 인터넷 연결을 확인하고 새로고침해주세요.',true); return; }
    // Isolates browser session state from legacy admin screens; DB policies enforce authorization.
    client = window.supabase.createClient(config.url, config.key, {auth:{storageKey:'fwt-member-session-v1'}});
    client.auth.onAuthStateChange((event) => {
      if(event === 'PASSWORD_RECOVERY') { recovery = true; passwordScreen(); }
      if(event === 'SIGNED_OUT') location.replace('./index.html');
    });
    try { const {data,error} = await client.auth.getSession(); if(error) throw error; if(data.session) await showProfile(); }
    catch(error) { notice(friendly(error),true); }

  }
  start();
})();

