import type { UserValidateEvent } from '@netlify/functions';
export default {
 userValidate(event:UserValidateEvent){
  // Invitations and server-admin-created accounts only. user_metadata is never trusted.
  if(!event.user.invitedAt && event.user.appMetadata?.jvc_managed!==true)event.deny();
 }
};
