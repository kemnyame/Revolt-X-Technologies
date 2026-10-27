export function emailConnected(settings:Record<string,any>){
 return settings.email_provider==='gmail'
  ? settings.gmail_verified===1&&settings.gmail_schedule_registered===1&&!!settings.gmail_sender&&settings.gmail_sender===settings.sender_email
  : !!settings.encrypted_api_key;
}
