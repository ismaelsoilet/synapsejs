import { type Static, Type } from '@sinclair/typebox';
import type { SliceLoaderContext } from 'synapsejs';
import { PageHeader } from '../../shared/ui';

export const ProfileInputSchema = Type.Object(
  {
    id: Type.Optional(Type.String({ maxLength: 100 }))
  },
  { additionalProperties: true }
);
export type ProfileInput = Static<typeof ProfileInputSchema>;

export interface ProfileLoaderData {
  id: string;
  name: string;
  role: string;
  location: string;
  joined: string;
  bio: string;
  stats: { projects: number; events: number; files: number };
  skills: string[];
}

export function ProfileLoader(context: SliceLoaderContext): ProfileLoaderData {
  const raw = context.params.id || 'demo-42';
  const id = raw.slice(0, 100);
  const name = id
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');

  return {
    id,
    name: name || 'Demo Member',
    role: 'Platform engineer',
    location: 'São Paulo · BR',
    joined: '2026-01-18',
    bio: 'Perfil resolvido por uma rota dinâmica /:domain/:name/:id. O loader recebe o parâmetro no SSR, o componente lê o mesmo valor no cliente via useParams e a hidratação não perde o contexto.',
    stats: { projects: 12, events: 148, files: 23 },
    skills: ['TypeScript', 'Bun', 'SQLite', 'SSR', 'Realtime', 'Design systems']
  };
}

export function ProfileView({ id, name, role, location, joined, bio, stats, skills }: ProfileLoaderData) {
  const initials = name
    .split(' ')
    .map((part) => part.charAt(0))
    .join('')
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Rota dinâmica"
        title={`Perfil de ${name}`}
        description={`O parâmetro :id desta página é "${id}". O mesmo loader foi executado no servidor e o componente foi hidratado no browser.`}
        actions={
          <a
            href="/showcase/home"
            className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-bold text-slate-300 hover:border-cyan-400/40 hover:text-cyan-300"
          >
            ← Voltar ao hub
          </a>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[0.85fr_1.15fr]">
        <div className="relative overflow-hidden rounded-3xl border border-slate-800 bg-gradient-to-br from-slate-900 via-slate-900 to-cyan-950/40 p-6">
          <div className="pointer-events-none absolute -right-12 -top-12 h-40 w-40 rounded-full bg-cyan-400/10 blur-3xl" />
          <div className="flex h-20 w-20 items-center justify-center rounded-3xl bg-gradient-to-br from-cyan-400 to-violet-500 text-2xl font-black text-slate-950 shadow-xl shadow-cyan-500/20">
            {initials}
          </div>
          <h2 className="mt-5 text-xl font-black text-white">{name}</h2>
          <div className="text-xs text-cyan-300">{role}</div>
          <div className="mt-2 font-mono text-[10px] text-slate-500">{location}</div>
          <div className="mt-5 grid grid-cols-3 gap-2 border-t border-slate-800 pt-4 text-center">
            {[
              ['Projetos', stats.projects],
              ['Eventos', stats.events],
              ['Arquivos', stats.files]
            ].map(([label, value]) => (
              <div key={label}>
                <div className="font-mono text-lg font-bold text-white">{value}</div>
                <div className="text-[9px] uppercase tracking-wider text-slate-500">{label}</div>
              </div>
            ))}
          </div>
          <div className="mt-5 rounded-xl border border-slate-800 bg-slate-950/40 p-3 font-mono text-[10px] text-slate-500">
            joined: <span className="text-slate-300">{joined}</span>
            <br />
            route: <span className="text-cyan-300">/showcase/profile/{id}</span>
          </div>
        </div>

        <div className="space-y-4">
          <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
            <h2 className="text-sm font-bold text-white">Bio</h2>
            <p className="mt-2 text-xs leading-relaxed text-slate-400">{bio}</p>
            <div className="mt-4 flex flex-wrap gap-1.5">
              {skills.map((skill) => (
                <span
                  key={skill}
                  className="rounded-full border border-cyan-400/20 bg-cyan-400/5 px-2.5 py-1 text-[10px] text-cyan-200"
                >
                  {skill}
                </span>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-950/40 p-5">
            <h2 className="text-sm font-bold text-white">Por que esta página importa</h2>
            <ul className="mt-3 space-y-2 text-xs leading-relaxed text-slate-400">
              <li>
                • O router reconhece <code className="text-cyan-300">/:domain/:name/:id</code> e passa params ao loader.
              </li>
              <li>
                • O cliente recebe <code className="text-cyan-300">__SYNAPSE_ROUTE_PARAMS__</code> e usa{' '}
                <code>useParams()</code>.
              </li>
              <li>• O mesmo componente renderiza no SSR e hidrata sem mismatch.</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}

export function sliceMeta() {
  return {
    title: 'Perfil | Synapse Showcase',
    description: 'Rota dinâmica /:domain/:name/:id com loader SSR e hidratação isomórfica.'
  };
}

export const sliceTests = {
  description: 'Invariantes da rota dinâmica',
  cases: [
    {
      name: 'o loader deriva o perfil do parâmetro id',
      run: async () => {
        const profile = ProfileLoader({ params: { id: 'ana-silva' } } as unknown as SliceLoaderContext);
        if (profile.id !== 'ana-silva' || !profile.name.includes('Ana')) {
          throw new Error('esperava o perfil derivado do id');
        }
      }
    }
  ]
};
