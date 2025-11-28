Game description - Objectives, win condition, draw game, etc.

1. player can press only a Key, defined with a constant. let the default key be E
2. Default number of players defined by a constant. let the initial value be 2
3. game mechanic:
    the game is split in 2 phases. a lobby and the play level.
    the game starts in the lobby, then it goes to the play level. after 1 round is finished, it goes back to the lobby
    the lobby shows the list of the players that are joining or already joined the game.
    the lobby shows their id, their username and the last game result.
    when a player enters the lobby, before joining the game, he can choose his name.
    the player can also set his name joining it using the url variable `username`.
    the player then can set ready to start with a button "ready to start".
    the first player that joins the lobby is the "host".
    the Host can decide to start the game even if there are not all the players designed. there must be at least 2 players.
    when all the players from the lobby are Ready, the game exits the lobby and enter the play level.
    the Host can enter the lobby if there is at least another player, with the button "Start game"
    this is a race game.
    once the track is opened, acountdown of 5 seconds shows on the screen starts. when it reaches 0, the game starts.
    all the players race on the athletic track. they run at a constant speed. pressing the button let them to move faster.
    the first to get to the finish line, wins

