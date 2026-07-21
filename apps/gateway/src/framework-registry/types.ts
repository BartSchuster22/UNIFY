import type {
  FrameworkRegistration,
  FrameworkRegistrationInput,
  FrameworkScope,
  HermesCapabilitiesResponse,
  HermesIdentityResponse,
  HermesVersionResponse,
} from '@aquiero/contracts';

export interface FrameworkRegistrationRecord extends FrameworkRegistration {
  serviceAuthReference: string;
}

export interface FrameworkRegistrationStore {
  ready(): Promise<boolean>;
  list(): Promise<FrameworkRegistrationRecord[]>;
  get(frameworkId: string): Promise<FrameworkRegistrationRecord | null>;
  upsert(input: FrameworkRegistrationRecord): Promise<FrameworkRegistrationRecord>;
  remove(frameworkId: string): Promise<boolean>;
}

export interface FrameworkProbeResult {
  identity: HermesIdentityResponse;
  version: HermesVersionResponse;
  capabilities: HermesCapabilitiesResponse;
}

export interface FrameworkProbe {
  inspect(baseUrl: string, bearerToken: string): Promise<FrameworkProbeResult>;
}

export type RegistrationInput = FrameworkRegistrationInput;

export interface FrameworkConnection {
  frameworkId: string;
  baseUrl: string;
  bearerToken: string;
  scopes: FrameworkScope[];
  frameworkVersion: string;
  frameworkCommit: string;
}
