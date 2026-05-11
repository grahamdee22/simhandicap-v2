CREATE TABLE match_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id uuid NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  message text NOT NULL CHECK (char_length(message) <= 500),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE match_messages ENABLE ROW LEVEL SECURITY;

-- SELECT: only match participants can read
CREATE POLICY "match participants can read messages"
ON match_messages FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM matches
    WHERE matches.id = match_messages.match_id
    AND (matches.player_1_id = auth.uid() OR matches.player_2_id = auth.uid())
  )
);

-- INSERT: own messages only, under 30 message cap
CREATE POLICY "users can insert own messages"
ON match_messages FOR INSERT
WITH CHECK (
  user_id = auth.uid()
  AND (
    SELECT COUNT(*) FROM match_messages WHERE match_id = match_messages.match_id
  ) < 30
);

