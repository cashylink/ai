import {
  collection,
  doc,
  addDoc,
  getDocs,
  writeBatch,
  query,
  orderBy,
  limit,
  serverTimestamp,
  updateDoc,
} from 'https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js';
import { db } from './firebase-config.js';
import {
  LOQUIRA_CATALOG_VERSION,
  encodeModelDocId,
  enrichCatalogForCustomer,
} from './loquira-models.js';

function userCollection(uid, name) {
  return collection(db, 'users', uid, name);
}

function mapProjects(snapshot) {
  return snapshot.docs.map(function (d) {
    const data = d.data();
    return {
      id: d.id,
      name: data.name || 'Untitled project',
      type: data.type || 'app',
      updatedAt: data.updatedAt?.toDate?.() || data.createdAt?.toDate?.() || null,
      createdAt: data.createdAt?.toDate?.() || null,
    };
  });
}

export async function fetchProjects(uid) {
  try {
    const q = query(userCollection(uid, 'projects'), orderBy('updatedAt', 'desc'));
    const snapshot = await getDocs(q);
    return mapProjects(snapshot);
  } catch (err) {
    if (err.code === 'failed-precondition') {
      const snapshot = await getDocs(userCollection(uid, 'projects'));
      const projects = mapProjects(snapshot);
      projects.sort(function (a, b) {
        return (b.updatedAt?.getTime() || 0) - (a.updatedAt?.getTime() || 0);
      });
      return projects;
    }
    throw err;
  }
}

export async function createProject(uid, { name, type }) {
  const now = serverTimestamp();
  const ref = await addDoc(userCollection(uid, 'projects'), {
    name: name.trim(),
    type: type || 'app',
    createdAt: now,
    updatedAt: now,
  });
  return ref.id;
}

export async function touchProject(uid, projectId) {
  const ref = doc(db, 'users', uid, 'projects', projectId);
  await updateDoc(ref, { updatedAt: serverTimestamp() });
}

export async function fetchAgentActivity(uid) {
  try {
    const q = query(userCollection(uid, 'agentActivity'), orderBy('updatedAt', 'desc'), limit(10));
    const snapshot = await getDocs(q);
    return snapshot.docs.map(function (d) {
      const data = d.data();
      return {
        id: d.id,
        title: data.title || 'Agent task',
        status: data.status || 'completed',
        filesChanged: data.filesChanged ?? 0,
        updatedAt: data.updatedAt?.toDate?.() || null,
      };
    });
  } catch (err) {
    if (err.code === 'failed-precondition') {
      const snapshot = await getDocs(userCollection(uid, 'agentActivity'));
      const items = snapshot.docs.map(function (d) {
        const data = d.data();
        return {
          id: d.id,
          title: data.title || 'Agent task',
          status: data.status || 'completed',
          filesChanged: data.filesChanged ?? 0,
          updatedAt: data.updatedAt?.toDate?.() || null,
        };
      });
      items.sort(function (a, b) {
        return (b.updatedAt?.getTime() || 0) - (a.updatedAt?.getTime() || 0);
      });
      return items.slice(0, 10);
    }
    throw err;
  }
}

function mapLoquiraModelDoc(d) {
  const data = d.data();
  return {
    id: data.modelId || d.id,
    name: data.name || 'Model',
    detail: data.detail || '',
    group: data.group || 'Other',
    supportsVision: !!data.supportsVision,
    supportsTools: data.supportsTools !== false,
    supportsReasoning: !!data.supportsReasoning,
    capabilities: Array.isArray(data.capabilities) ? data.capabilities : [],
    pickerOrder: typeof data.pickerOrder === 'number' ? data.pickerOrder : 999,
    catalogVersion: data.catalogVersion || '',
    syncedAt: data.syncedAt?.toDate?.() || null,
  };
}

/** Sync LOQUIRA app model catalog to Firestore (customer-facing metadata only). */
export async function syncLoquiraModels(uid) {
  const enriched = enrichCatalogForCustomer();
  const batch = writeBatch(db);
  const now = serverTimestamp();

  enriched.forEach(function (model) {
    const ref = doc(db, 'users', uid, 'loquiraModels', encodeModelDocId(model.id));
    batch.set(ref, {
      modelId: model.id,
      name: model.name,
      detail: model.detail,
      group: model.group,
      supportsVision: model.supportsVision,
      supportsTools: model.supportsTools,
      supportsReasoning: model.supportsReasoning,
      capabilities: model.capabilities,
      pickerOrder: model.pickerOrder,
      catalogVersion: LOQUIRA_CATALOG_VERSION,
      syncedAt: now,
    }, { merge: true });
  });

  const metaRef = doc(db, 'users', uid, 'settings', 'loquira-sync');
  batch.set(metaRef, {
    catalogVersion: LOQUIRA_CATALOG_VERSION,
    modelCount: enriched.length,
    updatedAt: now,
  }, { merge: true });

  await batch.commit();
  return enriched;
}

export async function fetchLoquiraModels(uid) {
  try {
    const snapshot = await getDocs(userCollection(uid, 'loquiraModels'));
    if (snapshot.empty) {
      return [];
    }
    const models = snapshot.docs.map(mapLoquiraModelDoc);
    models.sort(function (a, b) {
      return a.pickerOrder - b.pickerOrder;
    });
    return models;
  } catch (err) {
    if (err.code === 'permission-denied') throw err;
    return [];
  }
}

/** Load models from Firestore; seed/sync catalog when missing or outdated. */
export async function ensureLoquiraModels(uid) {
  let models = await fetchLoquiraModels(uid);
  const needsSync =
    models.length === 0 ||
    models.some(function (m) {
      return m.catalogVersion !== LOQUIRA_CATALOG_VERSION;
    });

  if (needsSync) {
    models = await syncLoquiraModels(uid);
  } else {
    models = enrichCatalogForCustomer();
  }

  return models;
}

export function formatRelativeTime(date) {
  if (!date) return 'Recently';
  const now = Date.now();
  const diff = now - date.getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return 'Updated ' + minutes + ' min ago';
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return 'Updated ' + hours + 'h ago';
  const days = Math.floor(hours / 24);
  if (days === 1) return 'Updated yesterday';
  if (days < 7) return 'Updated ' + days + ' days ago';
  return 'Updated ' + date.toLocaleDateString();
}

export function getProjectTypeLabel(type) {
  const labels = {
    app: 'Application',
    website: 'Website',
    api: 'API',
    other: 'Project',
  };
  return labels[type] || 'Project';
}
