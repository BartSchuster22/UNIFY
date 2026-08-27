package contract

type Manifest struct {
	SchemaVersion       string              `json:"schemaVersion"`
	CanonicalEncoding   string              `json:"canonicalEncoding"`
	ReleaseID           string              `json:"releaseId"`
	ReleaseVersion      string              `json:"releaseVersion"`
	CreatedAt           string              `json:"createdAt"`
	CellContract        string              `json:"cellContract"`
	ReleaseClass        string              `json:"releaseClass"`
	Installable         bool                `json:"installable"`
	Product             ProductBinding      `json:"product"`
	Profiles            []string            `json:"profiles"`
	Platforms           []Platform          `json:"platforms"`
	Sources             []Source            `json:"sources"`
	Components          []Component         `json:"components"`
	Topology            Topology            `json:"topology"`
	Compatibility       Compatibility       `json:"compatibility"`
	MigrationPlan       MigrationPlan       `json:"migrationPlan"`
	Rollback            Rollback            `json:"rollback"`
	DataUnits           []DataUnit          `json:"dataUnits"`
	Endpoints           []Endpoint          `json:"endpoints"`
	SecretRequirements  []SecretRequirement `json:"secretRequirements"`
	AcceptanceSuite     ArtifactDescriptor  `json:"acceptanceSuite"`
	ReleaseNotes        ArtifactDescriptor  `json:"releaseNotes"`
	KnownRisks          []string            `json:"knownRisks"`
	IrreversibleChanges []string            `json:"irreversibleChanges"`
}

type ProductBinding struct {
	ProductID      string   `json:"productId"`
	ReleaseLine    string   `json:"releaseLine"`
	Profile        string   `json:"profile"`
	FreezeDigest   string   `json:"freezeDigest"`
	BinaryLicense  string   `json:"binaryLicense"`
	EULADigest     string   `json:"eulaDigest"`
	CentralRuntime []string `json:"centralRuntimeDependencies"`
}

type Platform struct {
	OSID                 string          `json:"osId"`
	OSVersion            string          `json:"osVersion"`
	Architecture         string          `json:"architecture"`
	Init                 string          `json:"init"`
	Docker               VersionRange    `json:"docker"`
	Compose              VersionRange    `json:"compose"`
	Minimum              ResourceMinimum `json:"minimum"`
	UpgradeHeadroomBytes int64           `json:"upgradeHeadroomBytes"`
}

type VersionRange struct {
	MinimumInclusive string `json:"minimumInclusive"`
	MaximumExclusive string `json:"maximumExclusive"`
}

type ResourceMinimum struct {
	VCPU          int   `json:"vcpu"`
	MemoryBytes   int64 `json:"memoryBytes"`
	FreeDiskBytes int64 `json:"freeDiskBytes"`
}

type Source struct {
	Repository string `json:"repository"`
	Commit     string `json:"commit"`
	TreeDigest string `json:"treeDigest"`
}

type Component struct {
	ComponentID       string             `json:"componentId"`
	Authority         string             `json:"authority"`
	Version           string             `json:"version"`
	Kind              string             `json:"kind"`
	Realization       string             `json:"realization"`
	Artifact          string             `json:"artifact"`
	Digest            string             `json:"digest"`
	SignaturePolicy   string             `json:"signaturePolicy"`
	SBOM              ArtifactDescriptor `json:"sbom"`
	Provenance        ArtifactDescriptor `json:"provenance"`
	ComponentContract string             `json:"componentContract"`
	Provides          []string           `json:"provides"`
	Requires          []string           `json:"requires"`
	ConfigSchema      DigestDescriptor   `json:"configSchema"`
	DataSchema        DataSchema         `json:"dataSchema"`
}

type ArtifactDescriptor struct {
	ID       string `json:"id"`
	Artifact string `json:"artifact"`
	Digest   string `json:"digest"`
}

type DigestDescriptor struct {
	ID     string `json:"id"`
	Digest string `json:"digest"`
}

type DataSchema struct {
	Authority string `json:"authority"`
	Target    string `json:"target"`
}

type Topology struct {
	Project    string              `json:"project"`
	Labels     LabelContract       `json:"labels"`
	Containers []ContainerContract `json:"containers"`
	Networks   []NetworkContract   `json:"networks"`
	Volumes    []VolumeContract    `json:"volumes"`
	HostUnits  []HostUnitContract  `json:"hostUnits"`
}

type LabelContract struct {
	CellID      string `json:"cellId"`
	ReleaseID   string `json:"releaseId"`
	ComponentID string `json:"componentId"`
	Managed     string `json:"managed"`
}

type ContainerContract struct {
	ComponentID    string         `json:"componentId"`
	Service        string         `json:"service"`
	Networks       []string       `json:"networks"`
	Volumes        []string       `json:"volumes"`
	PublishedPorts []PortContract `json:"publishedPorts"`
	HealthRequired bool           `json:"healthRequired"`
}

type PortContract struct {
	HostIP    string `json:"hostIp"`
	Published int    `json:"published"`
	Target    int    `json:"target"`
	Protocol  string `json:"protocol"`
}

type NetworkContract struct {
	ID       string `json:"id"`
	Internal bool   `json:"internal"`
}

type VolumeContract struct {
	ID        string `json:"id"`
	Authority string `json:"authority"`
}

type HostUnitContract struct {
	ComponentID string `json:"componentId"`
	Unit        string `json:"unit"`
	Required    bool   `json:"required"`
}

type Compatibility struct {
	FreshInstall     bool                `json:"freshInstall"`
	SupportedOrigins []CompatibilityEdge `json:"supportedOrigins"`
}

type CompatibilityEdge struct {
	ReleaseID      string   `json:"releaseId"`
	ManifestDigest string   `json:"manifestDigest"`
	Profiles       []string `json:"profiles"`
	Evidence       []string `json:"evidence"`
}

type MigrationPlan struct {
	PlanID string          `json:"planId"`
	Steps  []MigrationStep `json:"steps"`
}

type MigrationStep struct {
	StepID             string   `json:"stepId"`
	Authority          string   `json:"authority"`
	ToolDigest         string   `json:"toolDigest"`
	DependsOn          []string `json:"dependsOn"`
	From               string   `json:"from"`
	To                 string   `json:"to"`
	Idempotent         bool     `json:"idempotent"`
	TimeoutSeconds     int      `json:"timeoutSeconds"`
	Verify             string   `json:"verify"`
	FailureDisposition string   `json:"failureDisposition"`
}

type Rollback struct {
	SupportedTargets []RollbackTarget `json:"supportedTargets"`
	ForwardRecovery  string           `json:"forwardRecovery"`
}

type RollbackTarget struct {
	ReleaseID string `json:"releaseId"`
	Class     string `json:"class"`
	Evidence  string `json:"evidence"`
}

type DataUnit struct {
	Authority      string `json:"authority"`
	BackupContract string `json:"backupContract"`
	RestoreOrder   int    `json:"restoreOrder"`
}

type Endpoint struct {
	ID       string `json:"id"`
	Exposure string `json:"exposure"`
	Protocol string `json:"protocol"`
	Port     int    `json:"port"`
	Owner    string `json:"owner"`
}

type SecretRequirement struct {
	Reference string   `json:"reference"`
	Class     string   `json:"class"`
	Consumers []string `json:"consumers"`
}

type SignatureEnvelope struct {
	SchemaVersion  string `json:"schemaVersion"`
	Algorithm      string `json:"algorithm"`
	KeyID          string `json:"keyId"`
	ManifestDigest string `json:"manifestDigest"`
	Signature      string `json:"signature"`
}

type TrustKey struct {
	SchemaVersion string `json:"schemaVersion"`
	Algorithm     string `json:"algorithm"`
	KeyID         string `json:"keyId"`
	PublicKey     string `json:"publicKey"`
}
