package contract

import (
	"bytes"
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"sort"
	"strconv"
	"strings"
	"unicode/utf8"
)

const MaxManifestBytes = 2 * 1024 * 1024

func LoadManifest(path string) (*Manifest, []byte, string, error) {
	raw, err := readBounded(path, MaxManifestBytes)
	if err != nil {
		return nil, nil, "", err
	}
	if bytes.HasPrefix(raw, []byte{0xef, 0xbb, 0xbf}) {
		return nil, nil, "", errors.New("JSON BOM is forbidden")
	}
	if !utf8.Valid(raw) {
		return nil, nil, "", errors.New("manifest must be valid UTF-8")
	}
	var generic any
	if err := decodeStrictGeneric(raw, &generic); err != nil {
		return nil, nil, "", fmt.Errorf("strict manifest JSON: %w", err)
	}
	canonical, err := CanonicalJSON(generic)
	if err != nil {
		return nil, nil, "", err
	}
	var manifest Manifest
	if err := decodeClosed(raw, &manifest); err != nil {
		return nil, nil, "", fmt.Errorf("closed manifest contract: %w", err)
	}
	digest := sha256.Sum256(canonical)
	return &manifest, canonical, "sha256:" + hex.EncodeToString(digest[:]), nil
}

func LoadAndVerify(manifestPath, signaturePath, keyPath string) (*Manifest, string, error) {
	manifest, canonical, digest, err := LoadManifest(manifestPath)
	if err != nil {
		return nil, "", err
	}
	var envelope SignatureEnvelope
	if err := loadClosedFile(signaturePath, 64*1024, &envelope); err != nil {
		return nil, "", fmt.Errorf("signature envelope: %w", err)
	}
	var key TrustKey
	if err := loadClosedFile(keyPath, 64*1024, &key); err != nil {
		return nil, "", fmt.Errorf("trust key: %w", err)
	}
	if envelope.SchemaVersion != "alica-manifest-signature/v1" {
		return nil, "", errors.New("unsupported signature envelope schema")
	}
	if key.SchemaVersion != "alica-trust-key/v1" {
		return nil, "", errors.New("unsupported trust key schema")
	}
	if envelope.Algorithm != "ed25519" || key.Algorithm != "ed25519" {
		return nil, "", errors.New("only ed25519 is accepted")
	}
	if envelope.KeyID == "" || envelope.KeyID != key.KeyID {
		return nil, "", errors.New("signature key ID mismatch")
	}
	if envelope.ManifestDigest != digest {
		return nil, "", errors.New("signature manifest digest mismatch")
	}
	publicKey, err := base64.StdEncoding.DecodeString(key.PublicKey)
	if err != nil || len(publicKey) != ed25519.PublicKeySize {
		return nil, "", errors.New("invalid ed25519 public key")
	}
	signature, err := base64.StdEncoding.DecodeString(envelope.Signature)
	if err != nil || len(signature) != ed25519.SignatureSize {
		return nil, "", errors.New("invalid ed25519 signature encoding")
	}
	if !ed25519.Verify(ed25519.PublicKey(publicKey), canonical, signature) {
		return nil, "", errors.New("manifest signature verification failed")
	}
	if errs := ValidateManifest(manifest); len(errs) > 0 {
		return nil, "", fmt.Errorf("manifest validation failed: %s", strings.Join(errs, "; "))
	}
	return manifest, digest, nil
}

func CanonicalJSON(value any) ([]byte, error) {
	var out bytes.Buffer
	if err := appendCanonical(&out, value); err != nil {
		return nil, fmt.Errorf("canonical JSON: %w", err)
	}
	return out.Bytes(), nil
}

func appendCanonical(out *bytes.Buffer, value any) error {
	switch v := value.(type) {
	case nil:
		out.WriteString("null")
	case bool:
		if v {
			out.WriteString("true")
		} else {
			out.WriteString("false")
		}
	case string:
		encoded, _ := json.Marshal(v)
		out.Write(encoded)
	case json.Number:
		s := v.String()
		if strings.ContainsAny(s, ".eE+") {
			return fmt.Errorf("non-integer number %q is forbidden", s)
		}
		if _, err := strconv.ParseInt(s, 10, 64); err != nil {
			return fmt.Errorf("invalid bounded integer %q", s)
		}
		if s == "-0" || (len(s) > 1 && s[0] == '0') || strings.HasPrefix(s, "-0") {
			return fmt.Errorf("non-canonical integer %q", s)
		}
		out.WriteString(s)
	case []any:
		out.WriteByte('[')
		for i, item := range v {
			if i > 0 {
				out.WriteByte(',')
			}
			if err := appendCanonical(out, item); err != nil {
				return err
			}
		}
		out.WriteByte(']')
	case map[string]any:
		keys := make([]string, 0, len(v))
		for key := range v {
			keys = append(keys, key)
		}
		sort.Strings(keys)
		out.WriteByte('{')
		for i, key := range keys {
			if i > 0 {
				out.WriteByte(',')
			}
			encoded, _ := json.Marshal(key)
			out.Write(encoded)
			out.WriteByte(':')
			if err := appendCanonical(out, v[key]); err != nil {
				return err
			}
		}
		out.WriteByte('}')
	default:
		return fmt.Errorf("unsupported value %T", value)
	}
	return nil
}

func decodeStrictGeneric(raw []byte, destination *any) error {
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	value, err := parseTokenValue(decoder, map[string]bool{})
	if err != nil {
		return err
	}
	if decoder.More() {
		return errors.New("trailing JSON value")
	}
	var trailing any
	if err := decoder.Decode(&trailing); err == nil {
		return errors.New("trailing JSON value")
	}
	*destination = value
	return nil
}

func ValidateStrictJSON(raw []byte) error {
	if !utf8.Valid(raw) {
		return errors.New("JSON must be valid UTF-8")
	}
	var value any
	return decodeStrictGeneric(raw, &value)
}

func parseTokenValue(decoder *json.Decoder, ancestry map[string]bool) (any, error) {
	token, err := decoder.Token()
	if err != nil {
		return nil, err
	}
	switch t := token.(type) {
	case json.Delim:
		switch t {
		case '{':
			object := map[string]any{}
			for decoder.More() {
				keyToken, err := decoder.Token()
				if err != nil {
					return nil, err
				}
				key, ok := keyToken.(string)
				if !ok {
					return nil, errors.New("object key is not a string")
				}
				if _, exists := object[key]; exists {
					return nil, fmt.Errorf("duplicate object key %q", key)
				}
				child, err := parseTokenValue(decoder, ancestry)
				if err != nil {
					return nil, err
				}
				object[key] = child
			}
			end, err := decoder.Token()
			if err != nil || end != json.Delim('}') {
				return nil, errors.New("unterminated object")
			}
			return object, nil
		case '[':
			array := []any{}
			for decoder.More() {
				child, err := parseTokenValue(decoder, ancestry)
				if err != nil {
					return nil, err
				}
				array = append(array, child)
			}
			end, err := decoder.Token()
			if err != nil || end != json.Delim(']') {
				return nil, errors.New("unterminated array")
			}
			return array, nil
		default:
			return nil, fmt.Errorf("unexpected delimiter %q", t)
		}
	case string, bool, nil, json.Number:
		return t, nil
	default:
		return nil, fmt.Errorf("unsupported JSON token %T", token)
	}
}

func decodeClosed(raw []byte, destination any) error {
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	decoder.UseNumber()
	if err := decoder.Decode(destination); err != nil {
		return err
	}
	var trailing any
	if err := decoder.Decode(&trailing); err == nil {
		return errors.New("trailing JSON value")
	}
	return nil
}

func loadClosedFile(path string, max int64, destination any) error {
	raw, err := readBounded(path, max)
	if err != nil {
		return err
	}
	var generic any
	if err := decodeStrictGeneric(raw, &generic); err != nil {
		return err
	}
	return decodeClosed(raw, destination)
}

func readBounded(path string, max int64) ([]byte, error) {
	info, err := os.Lstat(path)
	if err != nil {
		return nil, err
	}
	if !info.Mode().IsRegular() {
		return nil, errors.New("input must be a regular file")
	}
	if info.Size() <= 0 || info.Size() > max {
		return nil, fmt.Errorf("input size must be 1..%d bytes", max)
	}
	return os.ReadFile(path)
}
