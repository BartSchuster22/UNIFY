\set ON_ERROR_STOP on
BEGIN;

INSERT INTO core.frameworks (id,name,endpoint,credential_reference,desired_state,observed_state)
VALUES ('frm_01M0EZ9T88FTEBJ9HNNTE1M18M','Phase 8 fixture','https://127.0.0.1:9','secret://phase8-fixture','active','available');
INSERT INTO core.profiles (id,framework_id,native_reference,name,desired_state,observed_state)
VALUES ('prf_01M0F2A1DGFEKB7WKBQM6JME6Z','frm_01M0EZ9T88FTEBJ9HNNTE1M18M','phase8-profile','Phase 8 profile','active','active');
INSERT INTO core.agent_profile_projections (
  agent_profile_id,framework_id,native_profile_alias,owner,source_version,owner_release,owner_commit,
  observed_at,accepted_at,freshness_state,fresh_until,payload_schema_key,payload_digest,
  projection_generation,local_revision,safe_display_name,protected,activity_state,predecessor_profile_id
) VALUES (
  'agp_01M0EZABTFE6F8EV5X88JEEE45','frm_01M0EZ9T88FTEBJ9HNNTE1M18M','phase8-profile','hermes',
  'owner-v1','fixture','0000000000000000000000000000000000000000',clock_timestamp(),clock_timestamp(),
  'current',clock_timestamp()+interval '1 hour','hermes-profile-safe/v1',decode(repeat('00',32),'hex'),
  1,1,'Phase 8 profile',false,'active','prf_01M0F2A1DGFEKB7WKBQM6JME6Z'
);

INSERT INTO core.framework_session_projections (
  framework_session_id,framework_id,agent_profile_id,native_session_alias,source_version,state,
  content_classification,retention_policy_key,observed_at
) VALUES (
  'fss_01M0F2A1DGFEKB7WKBQM6JME70','frm_01M0EZ9T88FTEBJ9HNNTE1M18M',
  'agp_01M0EZABTFE6F8EV5X88JEEE45','phase8-native-session','owner-v1','current',
  'metadata-only','chat-standard-v1',clock_timestamp()
), (
  'fss_01M0F2A1DGFEKB7WKBQM6JME7B','frm_01M0EZ9T88FTEBJ9HNNTE1M18M',
  'agp_01M0EZABTFE6F8EV5X88JEEE45','phase8-native-session-2','owner-v1','current',
  'metadata-only','chat-standard-v1',clock_timestamp()
);
INSERT INTO core.framework_executions (
  agent_execution_id,framework_id,agent_profile_id,native_execution_alias,source_version,state,observed_at,payload_digest
) VALUES (
  'aex_01M0F2A1DGFEKB7WKBQM6JME71','frm_01M0EZ9T88FTEBJ9HNNTE1M18M',
  'agp_01M0EZABTFE6F8EV5X88JEEE45','phase8-native-execution','owner-v1','succeeded',clock_timestamp(),decode(repeat('11',32),'hex')
);
INSERT INTO core.chat_product_session_projections (
  product_conversation_authority,product_conversation_id,projection_revision,chat_session_native_id,
  principal_id,tenant_id,client_id,application_id,product_agent_id,agent_profile_id,
  authorization_reference,retention_policy_key,lifecycle_state,durable_event_cursor,source_version,payload_digest,observed_at
) VALUES (
  'chat.aquiero.com','con_01M0F2A1DGFEKB7WKBQM6JME72',1,'ses_phase8',
  'prn_01M0F1A1DMFQC9XTGPD3BT40M3','ten_01M0F1A1DMFXT9F836DYE5YGHP',
  'cli_01M0F1A1DME8G9MFXJTV5RYYHX','app_01M0F1A1DMEA2RVQJXXY1NWQ8D',
  'agt_01M0F1A1DME8G9MFXJTV5RYYHX','agp_01M0EZABTFE6F8EV5X88JEEE45',
  'ALICA-ADR-0008','chat-standard-v1','active',7,'chat-phase8/v0.1',decode(repeat('22',32),'hex'),clock_timestamp()
);
INSERT INTO core.chat_link_authorization_receipts (
  authorization_receipt_id,product_conversation_authority,product_conversation_id,projection_revision,
  principal_id,tenant_id,client_id,application_id,product_agent_id,agent_profile_id,
  decision,reason_code,scope_digest,authorization_reference,decided_at
) VALUES (
  'evd_01M0F2A1DGFEKB7WKBQM6JME73','chat.aquiero.com','con_01M0F2A1DGFEKB7WKBQM6JME72',1,
  'prn_01M0F1A1DMFQC9XTGPD3BT40M3','ten_01M0F1A1DMFXT9F836DYE5YGHP',
  'cli_01M0F1A1DME8G9MFXJTV5RYYHX','app_01M0F1A1DMEA2RVQJXXY1NWQ8D',
  'agt_01M0F1A1DME8G9MFXJTV5RYYHX','agp_01M0EZABTFE6F8EV5X88JEEE45',
  'allowed','P8_SCOPE_EXACT',decode(repeat('33',32),'hex'),'ALICA-ADR-0008',clock_timestamp()
);
INSERT INTO core.chat_framework_link_receipts (
  link_receipt_id,authorization_receipt_id,product_conversation_authority,product_conversation_id,
  framework_id,agent_profile_id,framework_session_id,agent_execution_id,chat_source_version,
  native_source_version,linkage_state,linked_at
) VALUES (
  'evd_01M0F2A1DGFEKB7WKBQM6JME74','evd_01M0F2A1DGFEKB7WKBQM6JME73',
  'chat.aquiero.com','con_01M0F2A1DGFEKB7WKBQM6JME72','frm_01M0EZ9T88FTEBJ9HNNTE1M18M',
  'agp_01M0EZABTFE6F8EV5X88JEEE45','fss_01M0F2A1DGFEKB7WKBQM6JME70',
  'aex_01M0F2A1DGFEKB7WKBQM6JME71','chat-phase8/v0.1','owner-v1','active',clock_timestamp()
);

DO $$ BEGIN
  BEGIN
    INSERT INTO core.chat_link_authorization_receipts VALUES (
      'evd_01M0F2A1DGFEKB7WKBQM6JME75','chat.aquiero.com','con_01M0F2A1DGFEKB7WKBQM6JME72',1,
      'prn_01M0F1A1DMFQC9XTGPD3BT40M3','ten_01M0F2A1DGFEKB7WKBQM6JME76',
      'cli_01M0F1A1DME8G9MFXJTV5RYYHX','app_01M0F1A1DMEA2RVQJXXY1NWQ8D',
      'agt_01M0F1A1DME8G9MFXJTV5RYYHX','agp_01M0EZABTFE6F8EV5X88JEEE45',
      'allowed','P8_SCOPE_EXACT',decode(repeat('44',32),'hex'),'ALICA-ADR-0008',clock_timestamp()
    );
    RAISE EXCEPTION 'cross-tenant authorization unexpectedly accepted';
  EXCEPTION WHEN foreign_key_violation THEN NULL; END;
END $$;

INSERT INTO core.chat_link_authorization_receipts (
  authorization_receipt_id,product_conversation_authority,product_conversation_id,projection_revision,
  principal_id,tenant_id,client_id,application_id,product_agent_id,agent_profile_id,
  decision,reason_code,scope_digest,authorization_reference,decided_at
) SELECT
  'evd_01M0F2A1DGFEKB7WKBQM6JME77',product_conversation_authority,product_conversation_id,projection_revision,
  principal_id,tenant_id,client_id,application_id,product_agent_id,agent_profile_id,
  'denied','P8_SCOPE_DENIED',decode(repeat('55',32),'hex'),'ALICA-ADR-0008',clock_timestamp()
FROM core.chat_product_session_projections WHERE product_conversation_id='con_01M0F2A1DGFEKB7WKBQM6JME72';
DO $$ BEGIN
  BEGIN
    INSERT INTO core.chat_framework_link_receipts (
      link_receipt_id,authorization_receipt_id,product_conversation_authority,product_conversation_id,
      framework_id,agent_profile_id,framework_session_id,chat_source_version,native_source_version,linkage_state,linked_at
    ) VALUES (
      'evd_01M0F2A1DGFEKB7WKBQM6JME78','evd_01M0F2A1DGFEKB7WKBQM6JME77',
      'chat.aquiero.com','con_01M0F2A1DGFEKB7WKBQM6JME72','frm_01M0EZ9T88FTEBJ9HNNTE1M18M',
      'agp_01M0EZABTFE6F8EV5X88JEEE45','fss_01M0F2A1DGFEKB7WKBQM6JME7B',
      'chat-phase8/v0.1','owner-v1','unresolved',clock_timestamp()
    );
    RAISE EXCEPTION 'denied authorization unexpectedly linked';
  EXCEPTION WHEN foreign_key_violation THEN NULL; END;
END $$;

INSERT INTO core.chat_link_authorization_receipts (
  authorization_receipt_id,product_conversation_authority,product_conversation_id,projection_revision,
  principal_id,tenant_id,client_id,application_id,product_agent_id,agent_profile_id,
  decision,reason_code,scope_digest,authorization_reference,decided_at
) SELECT
  'evd_01M0F2A1DGFEKB7WKBQM6JME7C',product_conversation_authority,product_conversation_id,projection_revision,
  principal_id,tenant_id,client_id,application_id,product_agent_id,agent_profile_id,
  'allowed','P8_SCOPE_EXACT',decode(repeat('77',32),'hex'),'ALICA-ADR-0008',clock_timestamp()
FROM core.chat_product_session_projections WHERE product_conversation_id='con_01M0F2A1DGFEKB7WKBQM6JME72';

DO $$ BEGIN
  BEGIN
    INSERT INTO core.chat_framework_link_receipts (
      link_receipt_id,authorization_receipt_id,product_conversation_authority,product_conversation_id,
      framework_id,agent_profile_id,framework_session_id,chat_source_version,native_source_version,linkage_state,linked_at
    ) VALUES (
      'evd_01M0F2A1DGFEKB7WKBQM6JME79','evd_01M0F2A1DGFEKB7WKBQM6JME7C',
      'chat.aquiero.com','con_01M0F2A1DGFEKB7WKBQM6JME72','frm_01M0EZ9T88FTEBJ9HNNTE1M18M',
      'agp_01M0EZABTFE6F8EV5X88JEEE45','fss_01M0F2A1DGFEKB7WKBQM6JME7B',
      'chat-phase8/v0.1','owner-v1','active',clock_timestamp()
    );
    RAISE EXCEPTION 'second active link unexpectedly accepted';
  EXCEPTION WHEN unique_violation THEN NULL; END;
END $$;

DO $$ BEGIN
  BEGIN
    UPDATE core.chat_framework_link_receipts SET native_source_version='tampered';
    RAISE EXCEPTION 'immutable receipt unexpectedly updated';
  EXCEPTION WHEN SQLSTATE '55000' THEN NULL;
  END;
END $$;

DO $$ BEGIN
  BEGIN
    INSERT INTO core.chat_integration_faults (
      fault_id,product_conversation_authority,reason_code,owner_mutation_count,evidence_digest
    ) VALUES ('evd_01M0F2A1DGFEKB7WKBQM6JME7A','chat.aquiero.com','P8_SCOPE_MISMATCH',1,decode(repeat('66',32),'hex'));
    RAISE EXCEPTION 'fault owner mutation unexpectedly accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
END $$;

SELECT json_build_object(
  'sessionProjections',(SELECT count(*) FROM core.chat_product_session_projections),
  'authorizationReceipts',(SELECT count(*) FROM core.chat_link_authorization_receipts),
  'activeLinkReceipts',(SELECT count(*) FROM core.chat_framework_link_receipts WHERE linkage_state='active'),
  'contentColumns',(SELECT count(*) FROM information_schema.columns WHERE table_schema='core' AND table_name LIKE 'chat_%' AND column_name IN ('message_content','message_body','attachment_content','prompt','tool_input','tool_output')),
  'auditFailures',(SELECT count(*) FROM core.verify_audit_chain())
) AS phase8_isolation_evidence;
ROLLBACK;
