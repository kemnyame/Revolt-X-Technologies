ALTER TABLE "email_log" ADD COLUMN "delivery_provider" text DEFAULT 'resend' NOT NULL;--> statement-breakpoint
ALTER TABLE "email_log" ADD COLUMN "dispatch_token" text;--> statement-breakpoint
ALTER TABLE "email_log" ADD COLUMN "claimed_at" text;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "email_provider" text DEFAULT 'resend' NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "gmail_sender" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "gmail_verified" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "gmail_schedule_registered" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "gmail_last_checked" text;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "gmail_last_result" text;
--> statement-breakpoint
CREATE FUNCTION icdd_gmail_delivery_permitted(p_id text,p_token text) RETURNS boolean
LANGUAGE sql AS $$
 SELECT EXISTS(
  SELECT 1 FROM email_log m CROSS JOIN settings s
  WHERE s.id=1 AND m.id=p_id AND m.dispatch_token=p_token AND m.status='dispatching'
   AND m.delivery_provider='gmail' AND s.email_provider='gmail' AND s.gmail_verified=1
   AND s.gmail_schedule_registered=1 AND s.gmail_sender=s.sender_email
   AND m.payload::jsonb->>'from'=s.sender_name||' <'||s.sender_email||'>'
   AND m.claimed_at::timestamptz>now()-interval '20 minutes'
   AND (m.id LIKE 'test-gmail-%' OR (s.enabled=1 AND s.recipients::jsonb ? m.recipient))
   AND NOT EXISTS(SELECT 1 FROM reminder_events e LEFT JOIN licenses l ON l.id=e.license_id WHERE e.email_id=m.id AND (l.id IS NULL OR l.archived_at IS NOT NULL OR l.expiry_date IS DISTINCT FROM e.expiry_date OR lower(btrim(l.status)) IN ('inactive','retired','suspended','cancelled','canceled')))
 );
$$;
--> statement-breakpoint
CREATE FUNCTION icdd_claim_gmail_delivery(p_sender text,p_limit integer DEFAULT 10) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE s settings%ROWTYPE; m email_log%ROWTYPE; t text; stamp text; deliveries jsonb:='[]'::jsonb; reviews integer;
BEGIN
 stamp:=to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
 SELECT * INTO s FROM settings WHERE id=1;
 IF NOT FOUND OR s.email_provider<>'gmail' OR s.gmail_verified<>1 OR s.gmail_schedule_registered<>1 THEN
  RETURN jsonb_build_object('state','not_configured','deliveries',deliveries);
 END IF;
 IF lower(p_sender)<>s.gmail_sender OR s.gmail_sender<>s.sender_email THEN
  UPDATE settings SET gmail_last_checked=stamp,gmail_last_result='account_mismatch' WHERE id=1;
  RETURN jsonb_build_object('state','account_mismatch','deliveries',deliveries);
 END IF;
 UPDATE reminder_events SET status='needs_review' WHERE email_id IN (SELECT id FROM email_log WHERE delivery_provider='gmail' AND status='dispatching' AND claimed_at::timestamptz<now()-interval '20 minutes');
 UPDATE email_log SET status='needs_review',error='Gmail submission was interrupted. Review the sent folder before any resend.',updated_at=stamp WHERE delivery_provider='gmail' AND status='dispatching' AND claimed_at::timestamptz<now()-interval '20 minutes';
 FOR m IN SELECT * FROM email_log WHERE delivery_provider='gmail' AND status='queued' AND (s.enabled=1 OR id LIKE 'test-gmail-%') ORDER BY created_at LIMIT greatest(1,least(p_limit,10)) FOR UPDATE SKIP LOCKED LOOP
  t:=gen_random_uuid()::text;
  UPDATE email_log SET status='dispatching',dispatch_token=t,claimed_at=stamp,attempts=attempts+1,updated_at=stamp WHERE id=m.id;
  IF NOT icdd_gmail_delivery_permitted(m.id,t) THEN
   UPDATE email_log SET status='cancelled',error='Sender, recipient or record changed before Gmail submission.',updated_at=stamp WHERE id=m.id;
   UPDATE reminder_events SET status='cancelled' WHERE email_id=m.id;
   CONTINUE;
  END IF;
  deliveries:=deliveries||jsonb_build_array(jsonb_build_object('id',m.id,'claim_token',t,'from_email',s.gmail_sender,'recipient',m.recipient,'subject',m.subject,'html',m.payload::jsonb->>'html','text',m.payload::jsonb->>'text','reply_to',m.payload::jsonb->>'reply_to'));
 END LOOP;
 SELECT count(*) INTO reviews FROM email_log WHERE status='needs_review';
 UPDATE settings SET gmail_last_checked=stamp,gmail_last_result=CASE WHEN reviews>0 THEN 'needs_review' WHEN jsonb_array_length(deliveries)>0 THEN 'dispatching' WHEN s.enabled=0 THEN 'paused' ELSE 'up_to_date' END WHERE id=1;
 RETURN jsonb_build_object('state',CASE WHEN jsonb_array_length(deliveries)>0 THEN 'dispatching' WHEN s.enabled=0 THEN 'paused' ELSE 'up_to_date' END,'checkedAt',stamp,'needsReview',reviews,'deliveries',deliveries);
END;
$$;
--> statement-breakpoint
CREATE FUNCTION icdd_finish_gmail_delivery(p_id text,p_token text,p_gmail_id text,p_error text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE stamp text; m email_log%ROWTYPE; accepted boolean;
BEGIN
 SELECT * INTO m FROM email_log WHERE id=p_id AND dispatch_token=p_token AND status='dispatching' FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'state','claim_not_active'); END IF;
 stamp:=to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
 accepted:=coalesce(p_gmail_id,'')~'^[a-zA-Z0-9_-]{4,200}$';
 UPDATE email_log SET status=CASE WHEN accepted THEN 'accepted' ELSE 'needs_review' END,provider_id=CASE WHEN accepted THEN p_gmail_id ELSE NULL END,error=CASE WHEN accepted THEN NULL ELSE left(coalesce(p_error,'Gmail acceptance is uncertain. Review before resending.'),350) END,updated_at=stamp WHERE id=m.id;
 UPDATE reminder_events SET status=CASE WHEN accepted THEN 'accepted' ELSE 'needs_review' END WHERE email_id=m.id;
 UPDATE settings SET gmail_last_checked=stamp,gmail_last_result=CASE WHEN accepted THEN 'accepted' ELSE 'needs_review' END,last_test_at=CASE WHEN accepted AND m.id LIKE 'test-gmail-%' THEN stamp ELSE last_test_at END WHERE id=1;
 RETURN jsonb_build_object('ok',true,'state',CASE WHEN accepted THEN 'accepted' ELSE 'needs_review' END,'recipient',m.recipient);
END;
$$;
