/** Secret-free display DTO. Secrets exist only in the dedicated write command. */
export type ServiceKind = 'llm' | 'realtime';
export type Health = 'unconfigured' | 'unverified' | 'ready' | 'auth_failed' | 'unsupported' | 'unavailable' | 'device_error';
export interface ModelSelectionView {
 provider_ref: string | null;
 model_ref: string;
 capability: 'unverified' | 'supported' | 'unsupported';
 connectivity: 'unverified' | 'connected' | 'auth_failed' | 'unavailable';
 health: Health;
 reasoning: string[];
 effort: string | null;
 voice_id: string;
}
export interface ModelConfigurationView {
 view_version: 2;
 config_version: number;
 source: 'unconfigured' | 'fixture' | 'user';
 providers: Array<{provider_id: string; service: ServiceKind; name: string; adapter: string; endpoint: string; credential_state: 'missing' | 'present' | 'storage_error'}>;
 defaults: Record<ServiceKind,ModelSelectionView>;
}
