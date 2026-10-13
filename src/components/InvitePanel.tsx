import { useEffect, useState, type FormEvent } from 'react';

type TeamOption = { id: string; name: string };

export function InvitePanel({organizationId,role}:{organizationId:string;role:string}) {
  const [teams,setTeams]=useState<TeamOption[]>([]);
  const [teamId,setTeamId]=useState('');
  const [email,setEmail]=useState('');
  const [inviteRole,setInviteRole]=useState('viewer');
  const [inviteUrl,setInviteUrl]=useState('');
  const [message,setMessage]=useState('');
  const [busy,setBusy]=useState(false);
  useEffect(()=>{
    let active=true;
    if(!organizationId){setTeams([]);setTeamId('');return ()=>{active=false;};}
    fetch(`/api/teams?organizationId=${encodeURIComponent(organizationId)}`).then(async response=>{
      const result=await response.json() as {data?:TeamOption[]};
      if(active&&response.ok){setTeams(result.data??[]);setTeamId(result.data?.[0]?.id??'');}
    }).catch(()=>{if(active)setMessage('Could not load teams.');});
    return ()=>{active=false;};
  },[organizationId]);
  async function submit(event:FormEvent<HTMLFormElement>){
    event.preventDefault();setBusy(true);setMessage('');setInviteUrl('');
    try{
      const response=await fetch('/api/invitations',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({organizationId,teamId,email,role:inviteRole})});
      const result=await response.json() as {inviteUrl?:string;error?:string};
      if(!response.ok)throw new Error(result.error??'Could not create invitation.');
      setInviteUrl(result.inviteUrl??'');setMessage('Invitation link created. Copy and send it to your teammate.');setEmail('');
    }catch(reason){setMessage(reason instanceof Error?reason.message:'Could not create invitation.');}
    finally{setBusy(false);}
  }
  if(role!=='owner'&&role!=='admin') return <section className="panel invite-panel"><h2>Team invitations</h2><p>An organization admin can invite engineers to this organization.</p></section>;
  return <section className="panel invite-panel"><h2>Invite an engineer</h2><p>Invitations are for one person and one team. The link expires in seven days.</p>{!organizationId&&<div className="auth-error">Select an organization above before creating an invite.</div>}<form className="invite-form" onSubmit={submit}><label>Email address<input type="email" value={email} onChange={event=>setEmail(event.target.value)} required/></label><label>Team<select value={teamId} onChange={event=>setTeamId(event.target.value)} required>{teams.map(team=><option key={team.id} value={team.id}>{team.name}</option>)}</select></label><label>Role<select value={inviteRole} onChange={event=>setInviteRole(event.target.value)}><option value="viewer">Viewer</option><option value="operator">Operator</option><option value="admin">Admin</option></select></label><button className="primary-button" type="submit" disabled={busy||!organizationId||!teamId}>{busy?'Creating…':'Create invite link'}</button></form>{message&&<div className={inviteUrl?'invite-success':'auth-error'}>{message}</div>}{inviteUrl&&<div className="invite-link"><input readOnly value={inviteUrl}/><button className="outline-button" type="button" onClick={()=>void navigator.clipboard.writeText(inviteUrl)}>Copy link</button></div>}</section>;
}
