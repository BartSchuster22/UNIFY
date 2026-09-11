"""Bounded migration mapping: exact Stage5 QA5 predecessor, preserve-only IDs.
Mappings describe identities, application delivery channels and paused native
schedules. Renaming/rebinding, live schedules and foreign occupants are refused.
"""
PREDECESSOR='1fde4fdfeea219bbad1e61e6bcce8046b2a7f9d880218d95a660624be08cd4f6'
KINDS=('identities','channels','schedules')
def plan(predecessor,source,mapping,occupied,*,quiescent,backup_verified):
 if predecessor!=PREDECESSOR:raise ValueError('Unsupported predecessor')
 if not quiescent or not backup_verified:raise ValueError('Quiescence and verified backup required')
 if set(source)!=set(KINDS) or set(mapping)!=set(KINDS) or set(occupied)!=set(KINDS):raise ValueError('Unknown mapping category')
 result={}
 for kind in KINDS:
  rows=source[kind]
  if not isinstance(rows,list) or not rows or any(not isinstance(s,str) or not s for s in rows) or len(set(rows))!=len(rows):raise ValueError('Source identity collision')
  pairs=mapping[kind]
  if not isinstance(pairs,list) or any(not isinstance(p,list) or len(p)!=2 for p in pairs):raise ValueError('Malformed mapping')
  if len(pairs)!=len(rows) or set(p[0] for p in pairs)!=set(rows):raise ValueError('Incomplete mapping')
  if len(set(p[1] for p in pairs))!=len(pairs):raise ValueError('Destination collision')
  for old,new in pairs:
   if old!=new:raise ValueError('Rebinding/renaming unsupported')
   if new in occupied[kind] and occupied[kind][new]!=old:raise ValueError('Foreign destination occupied')
  result[kind]=pairs
 return {'predecessor':predecessor,'mapping':result,'mode':'preserve-only','rollback':'verified cold code AND data preimage; never image-only','nonportable':'OS process/boot/container/network identifiers regenerated; retired QA3/QA4 archived, not activated; expired sessions/credentials renewed normally'}
