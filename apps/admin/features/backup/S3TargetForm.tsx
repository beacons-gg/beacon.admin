"use client";

import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Field, Panel } from "@/components/primitives";
import type { TargetDraft, TargetProblems } from "./logic";

/** One text field of the form and the wire schema's complaint about it. */
function TargetField({
  label,
  name,
  draft,
  problems,
  onChange,
  placeholder,
  type = "text",
  autoComplete = "off",
}: {
  label: string;
  name: Exclude<keyof TargetDraft, "forcePathStyle">;
  draft: TargetDraft;
  problems: TargetProblems;
  onChange: (patch: Partial<TargetDraft>) => void;
  placeholder?: string;
  type?: "text" | "password";
  autoComplete?: string;
}) {
  return (
    <div>
      <Field label={label}>
        <Input
          type={type}
          value={draft[name]}
          onChange={(e) => onChange({ [name]: e.target.value })}
          placeholder={placeholder}
          autoComplete={autoComplete}
          spellCheck={false}
          aria-invalid={problems[name] ? true : undefined}
          className="font-mono"
        />
      </Field>
      {problems[name] ? <p className="mt-1 text-xs text-destructive">{problems[name]}</p> : null}
    </div>
  );
}

/** Where a backup goes or comes from. Shared by both actions, so a restore reads what a backup wrote. */
export function S3TargetForm({
  draft,
  problems,
  onChange,
}: {
  draft: TargetDraft;
  problems: TargetProblems;
  onChange: (patch: Partial<TargetDraft>) => void;
}) {
  const shared = { draft, problems, onChange };
  return (
    <Panel title="Storage">
      <p className="mb-3 text-sm text-muted-foreground">
        An S3 bucket and a prefix inside it. This browser remembers where the backups live for this
        server. The access key and secret are typed in each time and are never saved.
      </p>
      <div className="grid max-w-2xl gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <TargetField
            {...shared}
            label="Endpoint (leave blank for AWS)"
            name="endpoint"
            placeholder="https://minio.example:9000"
          />
        </div>
        <TargetField {...shared} label="Region" name="region" placeholder="us-east-1" />
        <TargetField {...shared} label="Bucket" name="bucket" placeholder="my-beacon-backups" />
        <div className="sm:col-span-2">
          <TargetField {...shared} label="Prefix" name="prefix" placeholder="beacon/my-server" />
        </div>
        <TargetField {...shared} label="Access key" name="accessKeyId" />
        <TargetField
          {...shared}
          label="Secret"
          name="secretAccessKey"
          type="password"
          autoComplete="new-password"
        />
      </div>
      <label className="mt-3 flex items-center gap-2 text-sm">
        <Checkbox
          checked={draft.forcePathStyle}
          onCheckedChange={(on) => onChange({ forcePathStyle: on === true })}
        />
        Path style
      </label>
      <p className="mt-1 text-xs text-muted-foreground">
        Addresses the bucket by path instead of by name. Usually needed for MinIO.
      </p>
    </Panel>
  );
}
