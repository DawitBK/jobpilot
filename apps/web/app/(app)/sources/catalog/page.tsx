import type { Metadata } from 'next';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { PageHeader } from '@/components/ui';
import { api, requireMe } from '@/lib/server-api';
import type { CatalogEntry } from '@/lib/types';
import { CatalogBrowser } from './catalog-browser';

export const metadata: Metadata = { title: 'Add a job source', robots: { index: false } };

export default async function CatalogPage() {
  const me = await requireMe();
  if (!me.permissions.includes('sources:manage')) redirect('/dashboard');
  const entries = await api<CatalogEntry[]>('/sources/catalog');
  return (
    <>
      <PageHeader
        title="Add a job source"
        subtitle="Pick where JobPilot should look for jobs. Every source can be tried before it is added, and narrowed to what you want."
        actions={
          <Link className="btn" href="/sources">
            <ArrowLeft aria-hidden="true" className="h-4 w-4" /> Your sources
          </Link>
        }
      />
      <CatalogBrowser entries={entries} />
    </>
  );
}
