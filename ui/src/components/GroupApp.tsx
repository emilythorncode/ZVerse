import { useEffect, useMemo, useState } from 'react';
import { Contract } from 'ethers';
import { useAccount, usePublicClient, useReadContract } from 'wagmi';
import { Header } from './Header';
import { useEthersSigner } from '../hooks/useEthersSigner';
import { useZamaInstance } from '../hooks/useZamaInstance';
import { CONTRACT_ADDRESS, CONTRACT_ABI } from '../config/contracts';
import { normalizeGroupKey, openMessage, sealMessage, shortenAddress } from '../utils/messages';
import '../styles/GroupApp.css';

type GroupInfo = {
  id: number;
  name: string;
  encryptedKey: string;
  creator: string;
  memberCount: number;
};

type MessageItem = {
  index: number;
  sender: string;
  encryptedContent: string;
  timestamp: bigint;
  decoded?: string | null;
};


const CONTRACT_READY =true

export function GroupApp() {
  const { address } = useAccount();
  const signerPromise = useEthersSigner();
  const { instance, isLoading: zamaLoading, error: zamaError } = useZamaInstance();
  const client = usePublicClient();

  const [groups, setGroups] = useState<GroupInfo[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState<number | null>(null);
  const [members, setMembers] = useState<string[]>([]);
  const [messages, setMessages] = useState<MessageItem[]>([]);
  const [groupKey, setGroupKey] = useState<string | null>(null);
  const [newGroupName, setNewGroupName] = useState('');
  const [messageText, setMessageText] = useState('');
  const [creating, setCreating] = useState(false);
  const [joining, setJoining] = useState(false);
  const [sending, setSending] = useState(false);
  const [decoding, setDecoding] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [refreshVersion, setRefreshVersion] = useState(0);

  const selectedGroup = useMemo(
    () => groups.find((g) => g.id === selectedGroupId) ?? null,
    [groups, selectedGroupId]
  );

  const { data: groupCount, refetch: refetchGroupCount, isFetching: loadingGroupCount } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: CONTRACT_ABI,
    functionName: 'getGroupCount',
    query: { enabled: CONTRACT_READY },
  });

  const { data: membership, refetch: refetchMembership } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: CONTRACT_ABI,
    functionName: 'isGroupMember',
    args: selectedGroupId !== null && address ? [BigInt(selectedGroupId), address] : undefined,
    query: { enabled: CONTRACT_READY && selectedGroupId !== null && !!address },
  });

  useEffect(() => {
    if (!client || !CONTRACT_READY || groupCount === undefined) return;

    const loadGroups = async () => {
      const total = Number(groupCount);
      const next: GroupInfo[] = [];
      for (let i = 0; i < total; i++) {
        const [name, encryptedKey, creator, memberCount] = (await client.readContract({
          address: CONTRACT_ADDRESS,
          abi: CONTRACT_ABI,
          functionName: 'getGroup',
          args: [BigInt(i)],
        })) as [string, string, string, bigint];

        next.push({
          id: i,
          name,
          encryptedKey,
          creator,
          memberCount: Number(memberCount),
        });
      }

      setGroups(next);
      if (next.length > 0 && selectedGroupId === null) {
        setSelectedGroupId(next[0].id);
      }
    };

    loadGroups().catch((err) => {
      console.error(err);
      setStatus('Failed to load groups');
    });
  }, [client, groupCount, refreshVersion, selectedGroupId]);

  useEffect(() => {
    if (!client || selectedGroupId === null || !CONTRACT_READY) return;

    const loadGroupDetails = async () => {
      const memberList = (await client.readContract({
        address: CONTRACT_ADDRESS,
        abi: CONTRACT_ABI,
        functionName: 'getGroupMembers',
        args: [BigInt(selectedGroupId)],
      })) as string[];
      setMembers(memberList);

      const msgCount = (await client.readContract({
        address: CONTRACT_ADDRESS,
        abi: CONTRACT_ABI,
        functionName: 'getMessageCount',
        args: [BigInt(selectedGroupId)],
      })) as bigint;

      const total = Number(msgCount);
      const rows: MessageItem[] = [];
      for (let i = 0; i < total; i++) {
        const [sender, encryptedContent, timestamp] = (await client.readContract({
          address: CONTRACT_ADDRESS,
          abi: CONTRACT_ABI,
          functionName: 'getMessage',
          args: [BigInt(selectedGroupId), BigInt(i)],
        })) as [string, string, bigint];
        rows.push({ index: i, sender, encryptedContent, timestamp, decoded: null });
      }
      setMessages(rows);
    };

    loadGroupDetails().catch((err) => {
      console.error(err);
      setStatus('Unable to load group details');
    });
  }, [client, selectedGroupId, refreshVersion]);

  useEffect(() => {
    setGroupKey(null);
  }, [selectedGroupId]);

  const refresh = () => setRefreshVersion((v) => v + 1);

  const requireSigner = async () => {
    if (!signerPromise) {
      throw new Error('Connect a wallet to continue');
    }
    const signer = await signerPromise;
    if (!signer) {
      throw new Error('Signer unavailable');
    }
    return signer;
  };

  const handleCreateGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!CONTRACT_READY) {
      setStatus('Set the deployed contract address in config first.');
      return;
    }
    if (!newGroupName.trim()) return;
    setCreating(true);
    setStatus(null);

    try {
      const signer = await requireSigner();
      const contract = new Contract(CONTRACT_ADDRESS, CONTRACT_ABI, signer);
      const tx = await contract.createGroup(newGroupName.trim());
      await tx.wait();
      setNewGroupName('');
      await refetchGroupCount?.();
      refresh();
    } catch (err) {
      console.error(err);
      setStatus(err instanceof Error ? err.message : 'Failed to create group');
    } finally {
      setCreating(false);
    }
  };

  const handleJoinGroup = async () => {
    if (selectedGroupId === null) return;
    if (!CONTRACT_READY) {
      setStatus('Set the deployed contract address in config first.');
      return;
    }
    setJoining(true);
    setStatus(null);

    try {
      const signer = await requireSigner();
      const contract = new Contract(CONTRACT_ADDRESS, CONTRACT_ABI, signer);
      const tx = await contract.joinGroup(selectedGroupId);
      await tx.wait();
      await Promise.all([refetchMembership?.(), refetchGroupCount?.()]);
      refresh();
    } catch (err) {
      console.error(err);
      setStatus(err instanceof Error ? err.message : 'Failed to join group');
    } finally {
      setJoining(false);
    }
  };

  const runUserDecrypt = async (handles: string[]) => {
    if (!instance) throw new Error('Encryption service not ready');
    if (!address) throw new Error('Connect your wallet to decrypt');
    const signer = await requireSigner();

    const keypair = instance.generateKeypair();
    const startTimeStamp = Math.floor(Date.now() / 1000).toString();
    const durationDays = '7';
    const eip712 = instance.createEIP712(keypair.publicKey, [CONTRACT_ADDRESS], startTimeStamp, durationDays);

    const signature = await signer.signTypedData(
      eip712.domain,
      { UserDecryptRequestVerification: eip712.types.UserDecryptRequestVerification },
      eip712.message
    );

    return instance.userDecrypt(
      handles.map((handle) => ({ handle, contractAddress: CONTRACT_ADDRESS })),
      keypair.privateKey,
      keypair.publicKey,
      signature.replace('0x', ''),
      [CONTRACT_ADDRESS],
      address,
      startTimeStamp,
      durationDays
    );
  };

  const decryptKey = async () => {
    if (!selectedGroup || !CONTRACT_READY) {
      setStatus('Select a group and ensure the contract address is set');
      return;
    }

    setDecoding(true);
    setStatus(null);
    try {
      const result = await runUserDecrypt([selectedGroup.encryptedKey]);
      const raw = result[selectedGroup.encryptedKey as keyof typeof result];
      if (!raw) {
        throw new Error('No ciphertext returned');
      }
      const normalized = normalizeGroupKey(raw);
      setGroupKey(normalized);
    } catch (err) {
      console.error(err);
      setStatus(err instanceof Error ? err.message : 'Unable to decrypt group key');
    } finally {
      setDecoding(false);
    }
  };

  const decryptMessages = async () => {
    if (!groupKey || messages.length === 0) {
      setStatus('Decrypt the group key and ensure messages exist');
      return;
    }
    setDecoding(true);
    setStatus(null);

    try {
      const pending = messages.filter((m) => !m.decoded);
      if (pending.length === 0) {
        setDecoding(false);
        return;
      }

      const response = await runUserDecrypt(pending.map((m) => m.encryptedContent));
      const updated = messages.map((msg) => {
        const raw = response[msg.encryptedContent as keyof typeof response];
        if (!raw) return msg;
        try {
          const clear = openMessage(BigInt(raw), groupKey);
          return { ...msg, decoded: clear };
        } catch {
          return { ...msg, decoded: 'Unable to decode' };
        }
      });
      setMessages(updated);
    } catch (err) {
      console.error(err);
      setStatus(err instanceof Error ? err.message : 'Failed to decrypt messages');
    } finally {
      setDecoding(false);
    }
  };

  const handleSendMessage = async () => {
    if (!selectedGroupId && selectedGroupId !== 0) return;
    if (!groupKey) {
      setStatus('Decrypt the group key first');
      return;
    }
    if (!messageText.trim()) return;
    if (!CONTRACT_READY) {
      setStatus('Set the deployed contract address in config first.');
      return;
    }

    setSending(true);
    setStatus(null);

    try {
      const cipherValue = sealMessage(messageText.trim(), groupKey);
      const encryptedInput = await instance
        ?.createEncryptedInput(CONTRACT_ADDRESS, address)
        .add256(cipherValue)
        .encrypt();

      if (!encryptedInput) {
        throw new Error('Encryption failed');
      }

      const signer = await requireSigner();
      const contract = new Contract(CONTRACT_ADDRESS, CONTRACT_ABI, signer);
      const tx = await contract.sendMessage(
        selectedGroupId,
        encryptedInput.handles[0],
        encryptedInput.inputProof
      );
      await tx.wait();
      setMessageText('');
      refresh();
    } catch (err) {
      console.error(err);
      setStatus(err instanceof Error ? err.message : 'Failed to send message');
    } finally {
      setSending(false);
    }
  };

  const allowActions = CONTRACT_READY && !!address;

  return (
    <div className="group-app">
      <Header />
      <main className="group-main">
        <section className="hero">
          <div>
            <p className="eyebrow">Encrypted circles • FHE secured</p>
            <h1>Build private group chats with a shared secret key</h1>
            <p className="lede">
              Create a room, let members decrypt the shared key, and trade fully encrypted messages secured by Zama FHE.
            </p>
            <div className="hero-stats">
              <div>
                <p className="stat-value">{groupCount ? Number(groupCount) : 0}</p>
                <p className="stat-label">Groups live</p>
              </div>
              <div>
                <p className="stat-value">{selectedGroup ? selectedGroup.memberCount : 0}</p>
                <p className="stat-label">Members in focus</p>
              </div>
              <div>
                <p className="stat-value">{messages.length}</p>
                <p className="stat-label">Encrypted messages</p>
              </div>
            </div>
          </div>
          <div className="status-card">
            <div className="status-row">
              <span className="status-dot" data-state={allowActions ? 'ok' : 'warn'}></span>
              <span>{allowActions ? 'Wallet connected' : 'Connect a wallet to interact'}</span>
            </div>
            <div className="status-row">
              <span className="status-dot" data-state={CONTRACT_READY ? 'ok' : 'warn'}></span>
              <span>{CONTRACT_READY ? 'Contract ready' : 'Set contract address in config/contracts.ts'}</span>
            </div>
            <div className="status-row">
              <span className="status-dot" data-state={!zamaLoading && !zamaError ? 'ok' : 'warn'}></span>
              <span>
                {zamaLoading ? 'Initializing Zama relayer...' : zamaError ? 'Encryption unavailable' : 'Encryption online'}
              </span>
            </div>
          </div>
        </section>

        {status && <div className="inline-alert">{status}</div>}
        {zamaError && <div className="inline-alert warn">{zamaError}</div>}

        <div className="panels">
          <section className="panel">
            <div className="panel-header">
              <div>
                <p className="eyebrow">Create</p>
                <h2>Launch a new encrypted group</h2>
              </div>
              <span className="muted">A fresh random address A is encrypted on-chain for the room.</span>
            </div>
            <form className="create-form" onSubmit={handleCreateGroup}>
              <input
                type="text"
                placeholder="Group name"
                value={newGroupName}
                onChange={(e) => setNewGroupName(e.target.value)}
              />
              <button type="submit" disabled={!allowActions || creating}>
                {creating ? 'Deploying...' : 'Create group'}
              </button>
            </form>

            <div className="list-header">
              <h3>Groups</h3>
              {loadingGroupCount && <span className="muted">Loading...</span>}
            </div>
            <div className="group-list">
              {groups.length === 0 && <p className="muted">No groups yet. Create the first one.</p>}
              {groups.map((group) => (
                <button
                  key={group.id}
                  className={`group-card ${selectedGroupId === group.id ? 'active' : ''}`}
                  onClick={() => setSelectedGroupId(group.id)}
                >
                  <div className="group-card-top">
                    <h4>{group.name}</h4>
                    <span className="pill">{group.memberCount} members</span>
                  </div>
                  <p className="muted">Creator: {shortenAddress(group.creator)}</p>
                  <p className="muted small">Encrypted key: {group.encryptedKey.slice(0, 10)}…</p>
                </button>
              ))}
            </div>
          </section>

          <section className="panel">
            {selectedGroup ? (
              <>
                <div className="panel-header">
                  <div>
                    <p className="eyebrow">Group</p>
                    <h2>{selectedGroup.name}</h2>
                  </div>
                  <div className="chip-row">
                    <span className="pill soft">ID #{selectedGroup.id}</span>
                    {membership ? <span className="pill success">Member</span> : <span className="pill warn">Not joined</span>}
                  </div>
                </div>

                <div className="info-grid">
                  <div className="info-card">
                    <p className="muted">Group key</p>
                    <p className="key-value">{groupKey ?? 'Locked — decrypt to use A'}</p>
                    <div className="actions">
                      <button onClick={decryptKey} disabled={!membership || decoding || zamaLoading}>
                        {decoding ? 'Decrypting...' : 'Decrypt A'}
                      </button>
                      {!membership && (
                        <button className="ghost" onClick={handleJoinGroup} disabled={joining || zamaLoading}>
                          {joining ? 'Joining...' : 'Join group'}
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="info-card">
                    <p className="muted">Members</p>
                    <div className="member-list">
                      {members.length === 0 && <span className="muted small">No members yet</span>}
                      {members.map((m) => (
                        <span key={m} className="member-pill">
                          {shortenAddress(m)}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="messages-header">
                  <div>
                    <p className="eyebrow">Messages</p>
                    <h3>Encrypted history</h3>
                  </div>
                  <div className="chip-row">
                    <button className="ghost" onClick={decryptMessages} disabled={!groupKey || decoding || zamaLoading}>
                      {decoding ? 'Decrypting...' : 'Decrypt all'}
                    </button>
                    <span className="pill">{messages.length} stored</span>
                  </div>
                </div>

                <div className="message-list">
                  {messages.length === 0 && <p className="muted">No messages yet.</p>}
                  {messages.map((msg) => (
                    <div key={msg.index} className="message-card">
                      <div className="message-meta">
                        <span className="pill soft">#{msg.index}</span>
                        <span className="muted">{shortenAddress(msg.sender)}</span>
                        <span className="muted">{new Date(Number(msg.timestamp) * 1000).toLocaleString()}</span>
                      </div>
                      <p className="muted small">Cipher: {msg.encryptedContent.slice(0, 12)}…</p>
                      <div className="message-body">
                        {msg.decoded ? <p>{msg.decoded}</p> : <p className="muted">Encrypted with A</p>}
                      </div>
                    </div>
                  ))}
                </div>

                <div className="composer">
                  <div>
                    <p className="muted">Compose</p>
                    <p className="hint">Message is sealed with the decrypted A before FHE encryption.</p>
                  </div>
                  <div className="composer-row">
                    <input
                      type="text"
                      placeholder="Share something encrypted..."
                      value={messageText}
                      maxLength={120}
                      onChange={(e) => setMessageText(e.target.value)}
                    />
                    <button
                      onClick={handleSendMessage}
                      disabled={!membership || !groupKey || sending || zamaLoading || messageText.trim().length === 0}
                    >
                      {sending ? 'Sending...' : 'Send securely'}
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <div className="empty-state">
                <h3>Select or create a group</h3>
                <p className="muted">Encrypted chat details will show here.</p>
              </div>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}
