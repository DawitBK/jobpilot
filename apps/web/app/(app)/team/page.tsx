import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { EntityButton } from '@/components/entity-form';
import type { FieldDef } from '@/components/entity-form';
import { Badge, Empty, PageHeader, Table, statusTone } from '@/components/ui';
import { formatDate, label } from '@/lib/format';
import { api, requireMe } from '@/lib/server-api';
import type { Member } from '@/lib/types';

export const metadata: Metadata = { title: 'Team', robots: { index: false } };

const ROLES = ['ADMIN', 'RECRUITER', 'HIRING_MANAGER', 'ANALYST', 'CANDIDATE'].map((r) => ({
  value: r,
  label: label(r),
}));

const ADD: FieldDef[] = [
  {
    key: 'email',
    label: 'Email of an existing account',
    kind: 'email',
    required: true,
    createOnly: true,
    hint: 'They must already have registered',
  },
  { key: 'role', label: 'Role', kind: 'select', options: ROLES, initial: 'CANDIDATE' },
];
const EDIT: FieldDef[] = [
  { key: 'role', label: 'Role', kind: 'select', options: ROLES },
  {
    key: 'status',
    label: 'Membership',
    kind: 'select',
    options: [
      { value: 'ACTIVE', label: 'Active' },
      { value: 'REMOVED', label: 'Removed (signs them out of this organization at once)' },
    ],
  },
];

export default async function TeamPage() {
  const me = await requireMe();
  if (!me.permissions.includes('members:read')) redirect('/dashboard');
  const members = await api<Member[]>('/organization/members');
  const canInvite = me.permissions.includes('members:invite');
  return (
    <>
      <PageHeader
        title="Team"
        subtitle={me.organization.name}
        actions={
          canInvite ? (
            <EntityButton
              primary
              label="Add a member"
              title="Add a member"
              fields={ADD}
              createPath="/organization/members"
            />
          ) : null
        }
      />
      {members.length === 0 ? (
        <Empty>No members.</Empty>
      ) : (
        <Table head={['Name', 'Email', 'Role', 'Status', 'Joined', '']}>
          {members.map((m) => (
            <tr key={m.id}>
              <td className="td font-medium">{m.fullName}</td>
              <td className="td text-muted">{m.email}</td>
              <td className="td">
                <Badge tone={m.role === 'OWNER' ? 'info' : 'neutral'}>{label(m.role)}</Badge>
              </td>
              <td className="td">
                <Badge tone={statusTone(m.status)}>{label(m.status)}</Badge>
              </td>
              <td className="td">{formatDate(m.joinedAt)}</td>
              <td className="td text-right">
                {canInvite && m.role !== 'OWNER' && m.userId !== me.user.id ? (
                  <EntityButton
                    label="Change"
                    title={`Change ${m.fullName}`}
                    fields={EDIT}
                    record={m as unknown as Record<string, unknown> & { version: number }}
                    createPath="/organization/members"
                    updatePath={`/organization/members/${m.id}`}
                    versioned={false}
                  />
                ) : null}
              </td>
            </tr>
          ))}
        </Table>
      )}
    </>
  );
}
